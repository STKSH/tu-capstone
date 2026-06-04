package com.tucapstone.backend.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
public class LiveChatMessageRequest {

    @NotBlank
    @Pattern(regexp = "user|assistant", message = "role must be user or assistant")
    private String role;

    @NotBlank
    @Size(max = 4000)
    private String content;
}
