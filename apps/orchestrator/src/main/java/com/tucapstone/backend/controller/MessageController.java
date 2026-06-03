package com.tucapstone.backend.controller;

import com.tucapstone.backend.dto.request.MessageSaveRequest;
import com.tucapstone.backend.dto.response.MessageResponse;
import com.tucapstone.backend.service.MessageService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@Tag(name = "Message API", description = "강의 실시간 STT 자막 및 AI 채팅 메시지 API")
@RestController
@RequestMapping("/api/v1/messages")
@RequiredArgsConstructor
public class MessageController {

    private final MessageService messageService;

    @Operation(summary = "메시지 저장", description = "STT 자막이나 채팅 메시지를 DB에 즉시 저장합니다.")
    @PostMapping("/{lectureId}")
    public ResponseEntity<MessageResponse> saveMessage(
            @PathVariable Long lectureId,
            @RequestBody @Valid MessageSaveRequest request) {
        return ResponseEntity.ok(messageService.saveMessage(lectureId, request));
    }

    @Operation(summary = "메시지 목록 조회", description = "특정 강의의 모든 메시지 내역을 시간순으로 조회합니다. (기기 변경 후 복구용)")
    @GetMapping("/{lectureId}")
    public ResponseEntity<List<MessageResponse>> getMessages(@PathVariable Long lectureId) {
        return ResponseEntity.ok(messageService.getMessagesByLectureId(lectureId));
    }
}