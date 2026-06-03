package com.tucapstone.backend.service;

import com.tucapstone.backend.dto.request.MessageSaveRequest;
import com.tucapstone.backend.dto.response.MessageResponse;
import com.tucapstone.backend.entity.Lecture;
import com.tucapstone.backend.entity.Message;
import com.tucapstone.backend.repository.LectureRepository;
import com.tucapstone.backend.repository.MessageRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class MessageService {

    private final MessageRepository messageRepository;
    private final LectureRepository lectureRepository;

    @Transactional
    public MessageResponse saveMessage(Long lectureId, MessageSaveRequest request) {
        Lecture lecture = lectureRepository.findById(lectureId)
                .orElseThrow(() -> new RuntimeException("Lecture not found with ID: " + lectureId));

        Message message = Message.builder()
                .lecture(lecture)
                .content(request.getContent())
                .isAgent(request.getIsAgent())
                .build();

        Message savedMessage = messageRepository.save(message);

        return MessageResponse.builder()
                .id(savedMessage.getId())
                .content(savedMessage.getContent())
                .isAgent(savedMessage.getIsAgent())
                .createdAt(savedMessage.getCreatedAt())
                .build();
    }

    @Transactional(readOnly = true)
    public List<MessageResponse> getMessagesByLectureId(Long lectureId) {
        return messageRepository.findByLectureIdOrderByCreatedAtAsc(lectureId)
                .stream()
                .map(msg -> MessageResponse.builder()
                        .id(msg.getId())
                        .content(msg.getContent())
                        .isAgent(msg.getIsAgent())
                        .createdAt(msg.getCreatedAt())
                        .build())
                .collect(Collectors.toList());
    }
}