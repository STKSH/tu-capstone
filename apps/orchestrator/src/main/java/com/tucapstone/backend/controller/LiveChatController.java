package com.tucapstone.backend.controller;

import com.tucapstone.backend.dto.request.LiveChatRequest;
import com.tucapstone.backend.dto.response.LiveChatResponse;
import com.tucapstone.backend.service.LiveChatService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import java.util.Map;

@Tag(name = "Live Chat", description = "실시간 전사 기반 LLM 채팅 API")
@RestController
@RequestMapping("/api/chat")
@RequiredArgsConstructor
public class LiveChatController {

    private final LiveChatService liveChatService;

    @Operation(summary = "실시간 전사 기반 질문", description = "인증된 사용자의 질문을 agent-worker로 프록시하고 OpenRouter 응답을 반환합니다.")
    @PostMapping("/live")
    public ResponseEntity<?> askLiveChat(
            @AuthenticationPrincipal UserDetails userDetails,
            @Valid @RequestBody LiveChatRequest request
    ) {
        try {
            return ResponseEntity.ok(liveChatService.ask(request, userDetails.getUsername()));
        } catch (ResponseStatusException exception) {
            return ResponseEntity
                    .status(exception.getStatusCode())
                    .body(Map.of("message", exception.getReason() == null ? "Live chat request failed" : exception.getReason()));
        }
    }

    @Operation(summary = "실시간 전사 기반 질문 스트리밍", description = "인증된 사용자의 질문을 agent-worker로 프록시하고 OpenRouter 응답을 SSE로 스트리밍합니다.")
    @PostMapping(value = "/live/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public ResponseEntity<StreamingResponseBody> streamLiveChat(
            @AuthenticationPrincipal UserDetails userDetails,
            @Valid @RequestBody LiveChatRequest request
    ) {
        StreamingResponseBody stream = outputStream -> liveChatService.stream(
                request,
                userDetails.getUsername(),
                outputStream
        );

        return ResponseEntity.ok()
                .contentType(MediaType.TEXT_EVENT_STREAM)
                .body(stream);
    }

}
