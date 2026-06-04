package com.tucapstone.backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tucapstone.backend.dto.request.LiveChatRequest;
import com.tucapstone.backend.dto.response.LiveChatResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.util.StreamUtils;
import org.springframework.stereotype.Service;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Map;

@Slf4j
@Service
public class LiveChatService {

    private static final String LIVE_CHAT_PATH = "/llm/chat";
    private static final String LIVE_CHAT_STREAM_PATH = "/llm/chat/stream";
    private static final String INTERNAL_CHAT_SECRET_HEADER = "X-Internal-Chat-Secret";

    private final RestClient restClient;
    private final ObjectMapper objectMapper;
    private final String agentWorkerBaseUrl;
    private final String internalChatSecret;

    public LiveChatService(
            @Value("${agent-worker.base-url:http://agent-worker:8765}") String agentWorkerBaseUrl,
            @Value("${agent-worker.live-chat-secret:}") String internalChatSecret,
            RestClient.Builder restClientBuilder,
            ObjectMapper objectMapper
    ) {
        this.agentWorkerBaseUrl = agentWorkerBaseUrl;
        this.internalChatSecret = internalChatSecret;
        this.objectMapper = objectMapper;

        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(5000);
        requestFactory.setReadTimeout(50000);

        this.restClient = restClientBuilder
                .baseUrl(agentWorkerBaseUrl)
                .requestFactory(requestFactory)
                .build();
    }

    public LiveChatResponse ask(LiveChatRequest request, String userEmail) {
        ensureInternalChatSecret();

        try {
            LiveChatResponse response = restClient.post()
                    .uri(LIVE_CHAT_PATH)
                    .header(INTERNAL_CHAT_SECRET_HEADER, internalChatSecret)
                    .body(request)
                    .retrieve()
                    .onStatus(HttpStatusCode::isError, (clientRequest, clientResponse) -> {
                        log.warn(
                                "Live chat worker request failed for user={} status={}",
                                userEmail,
                                clientResponse.getStatusCode()
                        );
                        throw new ResponseStatusException(
                                HttpStatus.BAD_GATEWAY,
                                workerErrorMessage(clientResponse)
                        );
                    })
                    .body(LiveChatResponse.class);

            if (response == null || response.getAnswer() == null || response.getAnswer().isBlank()) {
                throw new ResponseStatusException(
                        HttpStatus.BAD_GATEWAY,
                        "Live chat worker response did not include answer"
                );
            }

            if (response.getModel() == null || response.getModel().isBlank()) {
                throw new ResponseStatusException(
                        HttpStatus.BAD_GATEWAY,
                        "Live chat worker response did not include model"
                );
            }

            return LiveChatResponse.builder()
                    .answer(response.getAnswer())
                    .grounding(normalizeGrounding(response.getGrounding()))
                    .model(response.getModel())
                    .build();
        } catch (ResponseStatusException exception) {
            throw exception;
        } catch (RestClientException exception) {
            log.warn("Live chat worker is unreachable for user={} baseUrl={}", userEmail, agentWorkerBaseUrl);
            throw new ResponseStatusException(
                    HttpStatus.BAD_GATEWAY,
                    "Live chat worker is unreachable"
            );
        }
    }

    public void stream(LiveChatRequest request, String userEmail, OutputStream outputStream) throws IOException {
        ensureInternalChatSecret();

        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) URI.create(agentWorkerBaseUrl.replaceAll("/+$", "") + LIVE_CHAT_STREAM_PATH)
                    .toURL()
                    .openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(0);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Accept", "text/event-stream");
            connection.setRequestProperty(INTERNAL_CHAT_SECRET_HEADER, internalChatSecret);

            objectMapper.writeValue(connection.getOutputStream(), request);

            int status = connection.getResponseCode();
            if (status >= 400) {
                String message = workerErrorMessage(connection.getErrorStream());
                log.warn("Live chat worker stream failed for user={} status={}", userEmail, status);
                writeSseError(outputStream, message);
                return;
            }

            try (InputStream inputStream = connection.getInputStream()) {
                StreamUtils.copy(inputStream, outputStream);
            }
        } catch (IOException exception) {
            log.warn("Live chat worker stream is unreachable for user={} baseUrl={}", userEmail, agentWorkerBaseUrl);
            writeSseError(outputStream, "Live chat worker stream is unreachable");
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private void ensureInternalChatSecret() {
        if (internalChatSecret == null || internalChatSecret.isBlank()) {
            throw new ResponseStatusException(
                    HttpStatus.INTERNAL_SERVER_ERROR,
                    "LIVE_CHAT_WORKER_SECRET is missing"
            );
        }
    }

    private void writeSseError(OutputStream outputStream, String message) throws IOException {
        String body = objectMapper.writeValueAsString(Map.of("message", message));
        outputStream.write(("event: error\ndata: " + body + "\n\n").getBytes(StandardCharsets.UTF_8));
        outputStream.flush();
    }


    private String workerErrorMessage(org.springframework.http.client.ClientHttpResponse clientResponse) {
        try {
            return workerErrorMessage(clientResponse.getBody());
        } catch (IOException ignored) {
            return "Live chat worker request failed";
        }
    }

    private String workerErrorMessage(InputStream inputStream) {
        if (inputStream == null) {
            return "Live chat worker request failed";
        }

        try {
            String body = StreamUtils.copyToString(inputStream, StandardCharsets.UTF_8);
            JsonNode root = objectMapper.readTree(body);
            JsonNode detail = root.get("detail");
            if (detail != null && detail.isTextual() && !detail.asText().isBlank()) {
                return detail.asText();
            }
        } catch (IOException ignored) {
            // Preserve controlled generic error below when worker body cannot be read.
        }
        return "Live chat worker request failed";
    }


    private String normalizeGrounding(String grounding) {
        if (grounding == null || grounding.isBlank()) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_GATEWAY,
                    "Live chat worker response did not include grounding"
            );
        }
        if ("transcript_only".equals(grounding)
                || "transcript_and_general_knowledge".equals(grounding)
                || "general_knowledge".equals(grounding)) {
            return grounding;
        }
        throw new ResponseStatusException(
                HttpStatus.BAD_GATEWAY,
                "Live chat worker response included invalid grounding"
        );
    }
}
