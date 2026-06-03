package com.tucapstone.backend.controller;

import com.tucapstone.backend.service.RecordService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.Map;

@Tag(name = "Record API", description = "녹음 기록 및 파일 관리 API")
@RestController
@RequestMapping("/api/v1/records")
@RequiredArgsConstructor
public class RecordController {

    private final RecordService recordService;

    @Operation(summary = "녹음 종료 및 저장", description = "클라이언트에서 녹음된 오디오와 전사 텍스트를 전송하여 저장합니다.")
    @PostMapping(value = "/{lectureId}/save", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<Void> saveRecord(
            @PathVariable Long lectureId,
            @RequestPart(value = "audio", required = false) MultipartFile audioFile,
            @RequestPart(value = "transcript", required = false) String transcript,
            @RequestParam(value = "duration", required = false) Integer duration) {
        
        recordService.saveRecordFromClient(lectureId, audioFile, transcript, duration);
        return ResponseEntity.noContent().build();
    }
    @Operation(summary = "녹음 일시정지 (Chunk 저장)", description = "일시정지 시 지금까지 녹음된 오디오 조각(Chunk)을 S3에 임시 저장하고 상태를 PAUSED로 변경합니다.")
    @PostMapping(value = "/{lectureId}/chunk", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<Void> saveChunk(
            @PathVariable Long lectureId,
            @RequestPart(value = "chunk") MultipartFile chunkFile) {

        recordService.saveChunk(lectureId, chunkFile);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "전사 자막 추가", description = "실시간으로 생성된 STT 자막 조각을 기존 전사 내역에 추가(Append)합니다.")
    @PostMapping("/{lectureId}/transcript")
    public ResponseEntity<Void> appendTranscript(
            @PathVariable Long lectureId,
            @RequestBody Map<String, String> body) {

        String content = body.get("content");
        recordService.appendTranscript(lectureId, content);
        return ResponseEntity.noContent().build();
    }
}