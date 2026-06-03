package com.tucapstone.backend.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class FFmpegService {

    public File mergeAudioFiles(List<File> chunkFiles) throws IOException, InterruptedException {
        if (chunkFiles == null || chunkFiles.isEmpty()) {
            throw new IllegalArgumentException("No chunk files provided for merging.");
        }

        if (chunkFiles.size() == 1) {
            return chunkFiles.get(0);
        }

        // Create a temporary text file listing all chunks for FFmpeg's concat demuxer
        Path listFilePath = Files.createTempFile("ffmpeg_list_", ".txt");
        StringBuilder listContent = new StringBuilder();
        for (File chunk : chunkFiles) {
            // format: file '/path/to/file'
            listContent.append("file '").append(chunk.getAbsolutePath().replace("\\", "/")).append("'\n");
        }
        Files.writeString(listFilePath, listContent.toString());

        File outputFile = File.createTempFile("merged_audio_" + UUID.randomUUID(), ".webm");

        // Execute FFmpeg concat command
        // ffmpeg -f concat -safe 0 -i list.txt -c copy output.webm
        ProcessBuilder processBuilder = new ProcessBuilder(
                "ffmpeg",
                "-f", "concat",
                "-safe", "0",
                "-i", listFilePath.toAbsolutePath().toString(),
                "-c", "copy",
                outputFile.getAbsolutePath()
        );

        processBuilder.redirectErrorStream(true);
        Process process = processBuilder.start();

        // Read output to prevent deadlock
        String output;
        try (var inputStream = process.getInputStream()) {
            output = new String(inputStream.readAllBytes());
        }

        int exitCode = process.waitFor();

        // Cleanup the list file
        Files.deleteIfExists(listFilePath);

        if (exitCode != 0) {
            log.error("FFmpeg merge failed with exit code {}. Output:\n{}", exitCode, output);
            if (outputFile.exists()) {
                outputFile.delete();
            }
            throw new RuntimeException("Failed to merge audio chunks using FFmpeg.");
        }

        log.info("Successfully merged {} chunks into {}", chunkFiles.size(), outputFile.getAbsolutePath());
        return outputFile;
    }
}