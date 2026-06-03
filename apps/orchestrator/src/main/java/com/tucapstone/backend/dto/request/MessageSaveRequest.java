package com.tucapstone.backend.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
@AllArgsConstructor
public class MessageSaveRequest {
    
    @NotBlank(message = "내용은 필수입니다.")
    private String content;

    @NotNull(message = "발화자 구분(AI 여부)은 필수입니다.")
    private Boolean isAgent;
}