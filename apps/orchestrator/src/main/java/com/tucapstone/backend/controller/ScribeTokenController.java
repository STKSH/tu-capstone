package com.tucapstone.backend.controller;

import com.tucapstone.backend.dto.response.ScribeTokenResponse;
import com.tucapstone.backend.service.ElevenLabsTokenService;
import com.tucapstone.backend.service.LectureService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "Scribe", description = "ElevenLabs Scribe token API")
@RestController
@RequestMapping("/api/lectures/{lectureId}/scribe-token")
@RequiredArgsConstructor
public class ScribeTokenController {

    private final ElevenLabsTokenService elevenLabsTokenService;
    private final LectureService lectureService;

    @Operation(
            summary = "ElevenLabs Scribe single-use token 발급",
            description = "현재 사용자가 소유한 강의에 대해서만 realtime_scribe 토큰을 발급합니다."
    )
    @PostMapping
    public ResponseEntity<ScribeTokenResponse> createToken(
            @PathVariable Long lectureId,
            @AuthenticationPrincipal UserDetails userDetails
    ) {
        lectureService.validateLectureOwner(userDetails.getUsername(), lectureId);
        return ResponseEntity.ok(
                elevenLabsTokenService.createRealtimeScribeToken(userDetails.getUsername())
        );
    }
}
