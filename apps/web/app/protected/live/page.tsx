'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import LiveLectureRoom from '@/components/LiveLectureRoom';
import { apiFetch } from '@/lib/api';
import { ENDPOINTS } from '@/lib/endpoints';

type LectureResponse = {
  id: number;
  title: string;
};

export default function LiveLecturePage() {
  const router = useRouter();
  const [lectureId, setLectureId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;

    async function createLiveLecture() {
      try {
        const lecture = await apiFetch<LectureResponse>(ENDPOINTS.LECTURE.CREATE, {
          method: 'POST',
          body: JSON.stringify({
            title: `Live lecture ${new Date().toLocaleString('ko-KR')}`,
          }),
        });

        if (!ignore) {
          setLectureId(lecture.id);
        }
      } catch (err) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : 'Failed to create lecture');
        }
      }
    }

    void createLiveLecture();

    return () => {
      ignore = true;
    };
  }, []);

  if (error) {
    return (
      <div className="flex min-h-[75vh] items-center justify-center px-6 text-center">
        <div>
          <h1 className="text-2xl font-black text-[#091426]">강의를 시작할 수 없습니다</h1>
          <p className="mt-3 text-sm font-medium text-[#75777d]">{error}</p>
        </div>
      </div>
    );
  }

  if (lectureId === null) {
    return (
      <div className="flex min-h-[75vh] items-center justify-center text-sm font-bold text-[#75777d]">
        강의 세션을 준비하는 중입니다...
      </div>
    );
  }

  return <LiveLectureRoom lectureId={lectureId} onEnd={() => router.push('/protected')} />;
}
