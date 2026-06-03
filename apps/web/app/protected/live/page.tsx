'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import LiveLectureRoom from '@/components/LiveLectureRoom';
import { Suspense } from 'react';

function LiveLectureContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const resumeId = searchParams.get('resumeId');

  return (
    <LiveLectureRoom 
      onEnd={() => router.push('/protected')} 
      resumeId={resumeId ? parseInt(resumeId) : undefined} 
    />
  );
}

export default function LiveLecturePage() {
  return (
    <Suspense fallback={<div className="p-8">Loading...</div>}>
      <LiveLectureContent />
    </Suspense>
  );
}
