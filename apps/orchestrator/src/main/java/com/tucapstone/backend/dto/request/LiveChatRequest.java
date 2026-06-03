package com.tucapstone.backend.dto.request;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

@Getter
@Setter
@NoArgsConstructor
public class LiveChatRequest {

    @NotBlank
    @Size(max = 2000)
    private String question;

    @Size(max = 12000)
    private String transcript = "";

    @Valid
    @Size(max = 20)
    private List<LiveChatMessageRequest> messages = new ArrayList<>();
}
