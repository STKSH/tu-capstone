package com.tucapstone.backend.service;

import com.tucapstone.backend.dto.response.ScribeTokenResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatusCode;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;
import org.springframework.web.server.ResponseStatusException;

@Slf4j
@Service
public class ElevenLabsTokenService {

    private static final String REALTIME_SCRIBE_TOKEN_PATH = "/v1/single-use-token/realtime_scribe";

    private final String apiKey;
    private final RestClient restClient;

    public ElevenLabsTokenService(
            @Value("${elevenlabs.api-key:}") String apiKey,
            RestClient.Builder restClientBuilder
    ) {
        this.apiKey = apiKey;
        this.restClient = restClientBuilder
                .baseUrl("https://api.elevenlabs.io")
                .build();
    }

    public ScribeTokenResponse createRealtimeScribeToken(String userEmail) {
        if (!StringUtils.hasText(apiKey)) {
            throw new ResponseStatusException(
                    HttpStatusCode.valueOf(500),
                    "ELEVENLABS_API_KEY is missing"
            );
        }

        ScribeTokenResponse response = restClient.post()
                .uri(REALTIME_SCRIBE_TOKEN_PATH)
                .header("xi-api-key", apiKey)
                .retrieve()
                .onStatus(HttpStatusCode::isError, (request, clientResponse) -> {
                    log.warn(
                            "ElevenLabs token request failed for user={} status={}",
                            userEmail,
                            clientResponse.getStatusCode()
                    );
                    throw new ResponseStatusException(
                            HttpStatusCode.valueOf(502),
                            "Failed to create ElevenLabs Scribe token"
                    );
                })
                .body(ScribeTokenResponse.class);

        if (response == null || !StringUtils.hasText(response.getToken())) {
            throw new ResponseStatusException(
                    HttpStatusCode.valueOf(502),
                    "ElevenLabs token response did not include token"
            );
        }

        log.info("Issued ElevenLabs realtime_scribe token for user={}", userEmail);
        return response;
    }
}
