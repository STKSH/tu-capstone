package com.tucapstone.backend.controller;

import com.tucapstone.backend.dto.response.ScribeTokenResponse;
import com.tucapstone.backend.service.ElevenLabsTokenService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "Scribe", description = "ElevenLabs Scribe token API")
@RestController
@RequestMapping("/api/scribe")
@RequiredArgsConstructor
public class ScribeTokenController {

    private final ElevenLabsTokenService elevenLabsTokenService;

    @Operation(summary = "ElevenLabs Scribe single-use token 발급", description = "인증된 사용자에게만 realtime_scribe 토큰을 발급합니다.")
    @PostMapping("/token")
    public ResponseEntity<ScribeTokenResponse> createToken(@AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(
                elevenLabsTokenService.createRealtimeScribeToken(userDetails.getUsername())
        );
    }
}
