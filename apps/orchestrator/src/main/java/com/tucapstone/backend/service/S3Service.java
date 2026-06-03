package com.tucapstone.backend.service;

import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.*;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class S3Service {

    private final S3Client s3Client;

    @Value("${minio.bucket}")
    private String bucketName;

    @PostConstruct
    public void init() {
        try {
            s3Client.headBucket(HeadBucketRequest.builder().bucket(bucketName).build());
            log.info("S3 Bucket '{}' exists.", bucketName);
        } catch (NoSuchBucketException e) {
            log.info("S3 Bucket '{}' does not exist. Creating it...", bucketName);
            s3Client.createBucket(CreateBucketRequest.builder().bucket(bucketName).build());
        } catch (S3Exception e) {
            if (e.statusCode() == 404) {
                log.info("S3 Bucket '{}' does not exist. Creating it...", bucketName);
                s3Client.createBucket(CreateBucketRequest.builder().bucket(bucketName).build());
            } else {
                throw e;
            }
        }
    }

    public String uploadFile(MultipartFile file, String folder) {
        if (file == null || file.isEmpty()) return null;

        String originalFilename = file.getOriginalFilename();
        String extension = "";
        if (originalFilename != null && originalFilename.contains(".")) {
            extension = originalFilename.substring(originalFilename.lastIndexOf("."));
        }
        
        String objectKey = folder + "/" + UUID.randomUUID() + extension;

        return uploadToS3(file, objectKey);
    }

    public String uploadChunk(Long lectureId, MultipartFile chunkFile) {
        if (chunkFile == null || chunkFile.isEmpty()) return null;
        
        // Use a timestamp to ensure chunks can be sorted chronologically
        String objectKey = "lectures/" + lectureId + "/chunks/" + System.currentTimeMillis() + "_" + UUID.randomUUID() + ".webm";
        return uploadToS3(chunkFile, objectKey);
    }

    public List<java.io.File> downloadChunksForLecture(Long lectureId) {
        String prefix = "lectures/" + lectureId + "/chunks/";
        
        try {
            ListObjectsV2Request listReq = ListObjectsV2Request.builder()
                    .bucket(bucketName)
                    .prefix(prefix)
                    .build();
            
            ListObjectsV2Response listRes = s3Client.listObjectsV2(listReq);
            List<java.io.File> chunkFiles = new java.util.ArrayList<>();
            
            // Sort by key to ensure chronological order (thanks to timestamp in key)
            listRes.contents().stream()
                    .map(S3Object::key)
                    .sorted()
                    .forEach(key -> {
                        try {
                            GetObjectRequest getReq = GetObjectRequest.builder()
                                    .bucket(bucketName)
                                    .key(key)
                                    .build();
                            
                            java.io.File tempFile = java.io.File.createTempFile("chunk_", ".webm");
                            tempFile.deleteOnExit();
                            s3Client.getObject(getReq, software.amazon.awssdk.core.sync.ResponseTransformer.toFile(tempFile));
                            chunkFiles.add(tempFile);
                        } catch (IOException e) {
                            log.error("Failed to download chunk: {}", key, e);
                        }
                    });
            
            return chunkFiles;
        } catch (S3Exception e) {
            log.error("Failed to list/download chunks for lecture {}", lectureId, e);
            throw new RuntimeException("S3에서 조각 파일을 가져오는 데 실패했습니다.", e);
        }
    }

    public void deleteChunksForLecture(Long lectureId) {
        String prefix = "lectures/" + lectureId + "/chunks/";
        try {
            ListObjectsV2Request listReq = ListObjectsV2Request.builder()
                    .bucket(bucketName)
                    .prefix(prefix)
                    .build();
            
            ListObjectsV2Response listRes = s3Client.listObjectsV2(listReq);
            
            for (S3Object s3Object : listRes.contents()) {
                s3Client.deleteObject(DeleteObjectRequest.builder()
                        .bucket(bucketName)
                        .key(s3Object.key())
                        .build());
            }
        } catch (S3Exception e) {
            log.error("Failed to delete chunks for lecture {}", lectureId, e);
        }
    }

    public String uploadFile(java.io.File file, String folder, String extension) {
        if (file == null || !file.exists()) return null;
        
        String objectKey = folder + "/" + UUID.randomUUID() + extension;

        try {
            PutObjectRequest putObjectRequest = PutObjectRequest.builder()
                    .bucket(bucketName)
                    .key(objectKey)
                    .build();

            s3Client.putObject(putObjectRequest, RequestBody.fromFile(file));
            log.info("File uploaded successfully to S3: {}", objectKey);
            return objectKey;
        } catch (S3Exception e) {
            log.error("Failed to upload file to S3", e);
            throw new RuntimeException("S3 업로드에 실패했습니다.", e);
        }
    }

    private String uploadToS3(MultipartFile file, String objectKey) {
        try {
            PutObjectRequest putObjectRequest = PutObjectRequest.builder()
                    .bucket(bucketName)
                    .key(objectKey)
                    .contentType(file.getContentType())
                    .build();

            s3Client.putObject(putObjectRequest, RequestBody.fromInputStream(file.getInputStream(), file.getSize()));
            log.info("File uploaded successfully to S3: {}", objectKey);
            return objectKey;
        } catch (S3Exception | IOException e) {
            log.error("Failed to upload file to S3", e);
            throw new RuntimeException("S3 업로드에 실패했습니다.", e);
        }
        }
        }