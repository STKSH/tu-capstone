package com.tucapstone.backend.controller;

import com.tucapstone.backend.dto.response.TokenResponse;
import com.tucapstone.backend.dto.response.UserResponse;
import com.tucapstone.backend.service.AuthService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "Auth", description = "인증 관련 API")
@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    @Operation(summary = "내 정보 조회", description = "현재 로그인한 사용자의 정보를 조회합니다.")
    @GetMapping("/me")
    public ResponseEntity<UserResponse> getMyInfo(@AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(authService.getMyInfo(userDetails.getUsername()));
    }

    @Operation(summary = "로그아웃", description = "현재 사용자의 세션을 종료합니다.")
    @PostMapping("/logout")
    public ResponseEntity<Void> logout(@AuthenticationPrincipal UserDetails userDetails) {
        authService.logout(userDetails.getUsername());
        return clearAuthCookies(ResponseEntity.ok()).build();
    }

    @Operation(summary = "계정 탈퇴", description = "현재 로그인한 사용자의 계정과 세션을 삭제합니다.")
    @DeleteMapping("/me")
    public ResponseEntity<Void> deleteMyAccount(@AuthenticationPrincipal UserDetails userDetails) {
        authService.deleteAccount(userDetails.getUsername());
        return clearAuthCookies(ResponseEntity.noContent()).build();
    }

    @Operation(summary = "로그인(임시)", description = "테스트용 로그인을 수행하고 토큰을 발급합니다.")
    @PostMapping("/login/temp")
    public ResponseEntity<TokenResponse> tempLogin(@RequestParam String email) {
        return ResponseEntity.ok(authService.login(email));
    }

    @Operation(summary = "토큰 갱신", description = "Refresh Token을 사용하여 Access Token을 재발급합니다.")
    @PostMapping("/refresh")
    public ResponseEntity<TokenResponse> refresh(
            @CookieValue(value = "refreshToken", required = false) String cookieRefreshToken,
            @RequestParam(required = false) String refreshToken
    ) {
        String token = cookieRefreshToken != null ? cookieRefreshToken : refreshToken;
        if (token == null) {
            return ResponseEntity.status(401).build();
        }

        TokenResponse tokenResponse = authService.refresh(token);

        ResponseCookie accessCookie = ResponseCookie.from("accessToken", tokenResponse.getAccessToken())
                .path("/")
                .httpOnly(true)
                .secure(false) // Change to true in production
                .sameSite("Lax")
                .maxAge(3600)
                .build();

        ResponseCookie refreshCookie = ResponseCookie.from("refreshToken", tokenResponse.getRefreshToken())
                .path("/")
                .httpOnly(true)
                .secure(false) // Change to true in production
                .sameSite("Lax")
                .maxAge(604800)
                .build();

        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, accessCookie.toString())
                .header(HttpHeaders.SET_COOKIE, refreshCookie.toString())
                .body(tokenResponse);
    }

    private ResponseEntity.HeadersBuilder<?> clearAuthCookies(ResponseEntity.HeadersBuilder<?> responseBuilder) {
        ResponseCookie accessCookie = ResponseCookie.from("accessToken", "")
                .path("/")
                .maxAge(0)
                .build();

        ResponseCookie refreshCookie = ResponseCookie.from("refreshToken", "")
                .path("/")
                .maxAge(0)
                .build();

        return responseBuilder
                .header(HttpHeaders.SET_COOKIE, accessCookie.toString())
                .header(HttpHeaders.SET_COOKIE, refreshCookie.toString());
    }
}
