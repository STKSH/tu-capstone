'use client';

import { useAuth } from "../../context/AuthContext";
import ProtectedRoute from "../../components/ProtectedRoute";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { 
  LayoutDashboard, 
  Settings,
  HelpCircle,
  Zap,
  PlusCircle,
  Bell,
  Radio,
  User as UserIcon,
  PlayCircle,
  LogOut,
  UserMinus,
  AlertTriangle,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState, useMemo } from "react";
import { apiFetch } from "@/lib/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Lecture {
  id: number;
  title: string;
  status: 'RECORDING' | 'PAUSED' | 'COMPLETED';
  createdAt: string;
}

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { logout, withdraw, user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  const handleWithdraw = async () => {
    setIsWithdrawing(true);
    try {
      await withdraw();
      router.push('/login');
    } catch (err) {
      console.error('Withdrawal failed', err);
      alert('회원 탈퇴에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setIsWithdrawing(false);
      setShowWithdrawModal(false);
    }
  };

  const fetchLectures = async () => {

    try {
      const data = await apiFetch<Lecture[]>('/api/lectures');
      setLectures(data);
    } catch (err) {
      console.error('Failed to fetch lectures', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLectures();
  }, [pathname]); // Refresh when navigating

  const groupedLectures = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const last7Days = new Date(today);
    last7Days.setDate(last7Days.getDate() - 7);

    return lectures.reduce((acc, lecture) => {
      const date = new Date(lecture.createdAt);
      if (date >= today) {
        acc.today.push(lecture);
      } else if (date >= yesterday) {
        acc.yesterday.push(lecture);
      } else if (date >= last7Days) {
        acc.last7Days.push(lecture);
      } else {
        acc.older.push(lecture);
      }
      return acc;
    }, {
      today: [] as Lecture[],
      yesterday: [] as Lecture[],
      last7Days: [] as Lecture[],
      older: [] as Lecture[]
    });
  }, [lectures]);

  const handleLectureClick = (lecture: Lecture) => {
    if (lecture.status === 'PAUSED' || lecture.status === 'RECORDING') {
      router.push(`/protected/live?resumeId=${lecture.id}`);
    } else {
      // Logic for viewing completed lecture (TBD)
      console.log('View completed lecture', lecture.id);
    }
  };

  return (
    <ProtectedRoute>
      <div className="flex min-h-screen w-full bg-[#fcfdfd] font-sans">
        
        {/* Sidebar */}
        <aside className="hidden w-[280px] shrink-0 border-r border-gray-100 bg-white md:flex flex-col h-screen overflow-y-auto">
          {/* Logo */}
          <div className="p-6 pb-8 flex items-center gap-3 font-extrabold text-xl tracking-tight text-gray-900">
            <div className="bg-[#0b1021] text-white p-1.5 rounded-lg flex items-center justify-center">
              <Zap className="h-5 w-5" />
            </div>
            에듀펄스 AI
          </div>

          <div className="px-5 pb-6">
            <Button
              type="button"
              onClick={() => router.push("/protected/live")}
              className="w-full bg-[#0b1021] hover:bg-[#0b1021]/90 text-white justify-start relative h-[52px] rounded-xl shadow-md"
            >
              <PlusCircle className="mr-3 h-[18px] w-[18px]" />
              <span className="font-bold text-[15px]">새 강의 시작</span>
              <span className="absolute right-4 text-[11px] text-white/50 font-medium">Ctrl+N</span>
            </Button>
          </div>

          <nav className="flex-1 px-3 space-y-8">
            <div className="space-y-1">
              <Link
                href="/protected"
                className={`flex items-center gap-3 rounded-xl px-4 py-3 text-[15px] font-bold transition-all ${
                  pathname === '/protected' 
                    ? "bg-[#f1f3f5] text-gray-900" 
                    : "text-gray-500 hover:bg-gray-50"
                }`}
              >
                <LayoutDashboard className="h-[18px] w-[18px]" />
                대시보드
              </Link>
              <Link
                href="/protected/live"
                className={`flex items-center gap-3 rounded-xl px-4 py-3 text-[15px] font-bold transition-all ${
                  pathname.startsWith('/protected/live') 
                    ? "bg-[#f1f3f5] text-gray-900" 
                    : "text-gray-500 hover:bg-gray-50"
                }`}
              >
                <Radio className="h-[18px] w-[18px]" />
                실시간 강의
              </Link>
            </div>

            <div className="space-y-4 px-2">
              {loading ? (
                <div className="px-2 text-xs font-bold text-gray-400">강의 목록 불러오는 중...</div>
              ) : lectures.length === 0 ? (
                <div className="px-2 text-xs font-bold text-gray-400">강의 내역이 없습니다.</div>
              ) : (
                <>
                  {groupedLectures.today.length > 0 && (
                    <div>
                      <h4 className="px-2 text-xs font-bold text-gray-400 mb-2">오늘</h4>
                      <div className="space-y-0.5">
                        {groupedLectures.today.map(lecture => (
                          <div 
                            key={lecture.id} 
                            onClick={() => handleLectureClick(lecture)}
                            className="group flex items-center justify-between px-2 py-2 text-[14px] font-medium text-gray-700 hover:text-gray-900 cursor-pointer rounded-lg hover:bg-gray-50 transition-colors"
                          >
                            <span className="truncate flex-1">{lecture.title}</span>
                            {lecture.status === 'PAUSED' && <PlayCircle className="h-4 w-4 text-[#006b5f] opacity-0 group-hover:opacity-100 transition-opacity" />}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {groupedLectures.yesterday.length > 0 && (
                    <div>
                      <h4 className="px-2 text-xs font-bold text-gray-400 mb-2">어제</h4>
                      <div className="space-y-0.5">
                        {groupedLectures.yesterday.map(lecture => (
                          <div 
                            key={lecture.id} 
                            onClick={() => handleLectureClick(lecture)}
                            className="group flex items-center justify-between px-2 py-2 text-[14px] font-medium text-gray-700 hover:text-gray-900 cursor-pointer rounded-lg hover:bg-gray-50 transition-colors"
                          >
                            <span className="truncate flex-1">{lecture.title}</span>
                            {lecture.status === 'PAUSED' && <PlayCircle className="h-4 w-4 text-[#006b5f] opacity-0 group-hover:opacity-100 transition-opacity" />}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {groupedLectures.last7Days.length > 0 && (
                    <div>
                      <h4 className="px-2 text-xs font-bold text-gray-400 mb-2">지난 7일</h4>
                      <div className="space-y-0.5">
                        {groupedLectures.last7Days.map(lecture => (
                          <div 
                            key={lecture.id} 
                            onClick={() => handleLectureClick(lecture)}
                            className="group flex items-center justify-between px-2 py-2 text-[14px] font-medium text-gray-700 hover:text-gray-900 cursor-pointer rounded-lg hover:bg-gray-50 transition-colors"
                          >
                            <span className="truncate flex-1">{lecture.title}</span>
                            {lecture.status === 'PAUSED' && <PlayCircle className="h-4 w-4 text-[#006b5f] opacity-0 group-hover:opacity-100 transition-opacity" />}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {groupedLectures.older.length > 0 && (
                    <div>
                      <h4 className="px-2 text-xs font-bold text-gray-400 mb-2">이전</h4>
                      <div className="space-y-0.5">
                        {groupedLectures.older.map(lecture => (
                          <div 
                            key={lecture.id} 
                            onClick={() => handleLectureClick(lecture)}
                            className="group flex items-center justify-between px-2 py-2 text-[14px] font-medium text-gray-700 hover:text-gray-900 cursor-pointer rounded-lg hover:bg-gray-50 transition-colors"
                          >
                            <span className="truncate flex-1">{lecture.title}</span>
                            {lecture.status === 'PAUSED' && <PlayCircle className="h-4 w-4 text-[#006b5f] opacity-0 group-hover:opacity-100 transition-opacity" />}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </nav>

          <div className="p-4 border-t border-gray-100 space-y-1">
            <Link
              href="/protected/settings"
              className="flex items-center gap-3 rounded-xl px-4 py-3 text-[14px] font-bold text-gray-600 hover:bg-gray-50 transition-all"
            >
              <Settings className="h-5 w-5" />
              설정
            </Link>
            <Link
              href="/protected/support"
              className="flex items-center gap-3 rounded-xl px-4 py-3 text-[14px] font-bold text-gray-600 hover:bg-gray-50 transition-all"
            >
              <HelpCircle className="h-5 w-5" />
              고객 센터
            </Link>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* Top Header */}
          <header className="flex items-center justify-end h-20 px-8 gap-5 shrink-0">
            <button className="text-gray-400 hover:text-gray-900 transition-colors">
              <Bell className="h-5 w-5" />
            </button>
            
            <DropdownMenu>
              <DropdownMenuTrigger className="w-10 h-10 rounded-full border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-all overflow-hidden bg-white shadow-sm outline-none">
                {user?.picture ? (
                  <img src={user.picture} alt={user.name} className="w-full h-full object-cover" />
                ) : (
                  <UserIcon className="h-5 w-5" />
                )}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 mt-2 p-2 rounded-2xl shadow-xl border border-gray-100 bg-white">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="px-3 py-3">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-bold text-gray-900">{user?.name || '사용자'}</p>
                      <p className="text-xs text-gray-500 truncate">{user?.email}</p>
                    </div>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator className="bg-gray-50" />
                <DropdownMenuItem 
                  onClick={() => logout()}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer text-gray-700 hover:bg-gray-50 transition-colors outline-none"
                >
                  <LogOut className="h-4 w-4" />
                  <span className="font-bold text-[14px]">로그아웃</span>
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => setShowWithdrawModal(true)}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer text-red-600 hover:bg-red-50 transition-colors outline-none"
                >
                  <UserMinus className="h-4 w-4" />
                  <span className="font-bold text-[14px]">회원 탈퇴</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </header>

          <div className="flex-1 overflow-y-auto">
            {children}
          </div>
        </main>
      </div>

      {/* Withdrawal Confirmation Modal */}
      {showWithdrawModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-[440px] rounded-[32px] bg-white p-10 shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-start mb-6">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50">
                <AlertTriangle className="h-7 w-7 text-red-600" />
              </div>
              <button 
                onClick={() => setShowWithdrawModal(false)}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X className="h-6 w-6 text-gray-400" />
              </button>
            </div>
            
            <h3 className="mb-3 text-2xl font-black text-gray-900">정말 탈퇴하시겠습니까?</h3>
            <p className="mb-8 text-[15px] leading-relaxed text-gray-500 font-medium">
              탈퇴하시면 모든 강의 내역과 실시간 전사 데이터가 삭제되며, 이 작업은 되돌릴 수 없습니다.
            </p>
            
            <div className="flex gap-4">
              <button 
                onClick={() => setShowWithdrawModal(false)}
                disabled={isWithdrawing}
                className="flex-1 rounded-2xl bg-gray-100 py-4 text-[15px] font-bold text-gray-600 hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                취소
              </button>
              <button 
                onClick={handleWithdraw}
                disabled={isWithdrawing}
                className="flex-1 rounded-2xl bg-red-600 py-4 text-[15px] font-bold text-white hover:bg-red-700 transition-colors shadow-lg shadow-red-200 disabled:opacity-50"
              >
                {isWithdrawing ? '처리 중...' : '탈퇴하기'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ProtectedRoute>
  );
}
