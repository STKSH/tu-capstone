package com.tucapstone.backend.service;

import com.tucapstone.backend.entity.Lecture;
import com.tucapstone.backend.entity.LectureStatus;
import com.tucapstone.backend.entity.Record;
import com.tucapstone.backend.repository.LectureRepository;
import com.tucapstone.backend.repository.RecordRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class RecordService {

    private final RecordRepository recordRepository;
    private final LectureRepository lectureRepository;
    private final S3Service s3Service;
    private final FFmpegService ffmpegService;

    @Transactional
    public void saveChunk(Long lectureId, MultipartFile chunkFile) {
        Lecture lecture = lectureRepository.findById(lectureId)
                .orElseThrow(() -> new RuntimeException("Lecture not found with ID: " + lectureId));

        if (lecture.getStatus() == LectureStatus.COMPLETED) {
            throw new RuntimeException("Cannot add chunks to a completed lecture.");
        }

        s3Service.uploadChunk(lectureId, chunkFile);
        
        lecture.setStatus(LectureStatus.PAUSED);
        lectureRepository.save(lecture);
    }

    @Transactional
    public void appendTranscript(Long lectureId, String content) {
        if (content == null || content.isBlank()) return;

        Lecture lecture = lectureRepository.findById(lectureId)
                .orElseThrow(() -> new RuntimeException("Lecture not found with ID: " + lectureId));

        Record record = recordRepository.findByLectureId(lecture.getId())
                .orElse(Record.builder()
                        .lecture(lecture)
                        .transcript("")
                        .build());

        String currentTranscript = record.getTranscript();
        if (currentTranscript == null || currentTranscript.isBlank()) {
            record.setTranscript(content);
        } else {
            record.setTranscript(currentTranscript + " " + content);
        }

        recordRepository.save(record);
    }

    @Transactional
    public void saveRecordFromClient(Long lectureId, MultipartFile finalAudioFile, String transcript, Integer duration) {
        Lecture lecture = lectureRepository.findById(lectureId)
                .orElseThrow(() -> new RuntimeException("Lecture not found with ID: " + lectureId));

        String finalAudioPath = null;
        List<File> chunkFiles = new java.util.ArrayList<>();
        File mergedFile = null;
        File tempFinalChunk = null;

        try {
            // If the lecture was paused, we might have chunks to merge
            if (lecture.getStatus() == LectureStatus.PAUSED) {
                // 1. Download existing chunks from S3
                chunkFiles.addAll(s3Service.downloadChunksForLecture(lectureId));

                // 2. Add the final audio file provided in this request to the list of chunks
                if (finalAudioFile != null && !finalAudioFile.isEmpty()) {
                    tempFinalChunk = File.createTempFile("final_chunk_", ".webm");
                    finalAudioFile.transferTo(tempFinalChunk);
                    chunkFiles.add(tempFinalChunk);
                }

                // 3. Merge all chunks using FFmpeg
                if (!chunkFiles.isEmpty()) {
                    mergedFile = ffmpegService.mergeAudioFiles(chunkFiles);
                    // 4. Upload the merged file to S3
                    finalAudioPath = s3Service.uploadFile(mergedFile, "audio", ".webm");

                    // Cleanup S3 chunks
                    s3Service.deleteChunksForLecture(lectureId);
                }
            } else {
                // Not paused, just a single continuous recording
                if (finalAudioFile != null && !finalAudioFile.isEmpty()) {
                    finalAudioPath = s3Service.uploadFile(finalAudioFile, "audio");
                }
            }
        } catch (Exception e) {
            log.error("Failed to merge and upload audio for lecture {}", lectureId, e);
            throw new RuntimeException("오디오 병합 및 저장에 실패했습니다.", e);
        } finally {
            // Explicitly cleanup all temporary files
            if (mergedFile != null && mergedFile.exists()) mergedFile.delete();
            if (tempFinalChunk != null && tempFinalChunk.exists()) tempFinalChunk.delete();
            for (File chunk : chunkFiles) {
                if (chunk != null && chunk.exists()) {
                    chunk.delete();
                }
            }
        }

        Record record = recordRepository.findByLectureId(lecture.getId())
                .orElse(Record.builder()
                        .lecture(lecture)
                        .build());

        if (finalAudioPath != null) record.setS3AudioPath(finalAudioPath);
        if (transcript != null) record.setTranscript(transcript);
        if (duration != null) record.setDuration(duration);

        recordRepository.save(record);
        
        lecture.setStatus(LectureStatus.COMPLETED);
        lectureRepository.save(lecture);
    }
}