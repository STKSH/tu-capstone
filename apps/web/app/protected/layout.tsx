'use client';

import { useState } from "react";
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
  LogOut,
  User as UserIcon,
  UserX,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { logout, withdrawAccount, user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isAccountActionPending, setIsAccountActionPending] = useState(false);

  const displayName = user?.name || user?.email || "사용자";

  const handleLogout = async () => {
    setIsAccountActionPending(true);
    try {
      await logout();
      router.push("/login");
    } finally {
      setIsAccountActionPending(false);
      setIsAccountMenuOpen(false);
    }
  };

  const handleWithdrawAccount = async () => {
    setIsAccountActionPending(true);
    try {
      await withdrawAccount();
      router.push("/login");
    } finally {
      setIsAccountActionPending(false);
      setIsAccountMenuOpen(false);
      setIsDeleteConfirmOpen(false);
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
                className="flex items-center gap-3 rounded-xl px-4 py-3 text-[15px] font-bold text-gray-500 hover:bg-gray-50 transition-all"
              >
                <Radio className="h-[18px] w-[18px]" />
                실시간 강의
              </Link>
            </div>

            <div className="space-y-3 px-2">
              <div>
                <h4 className="px-2 text-xs font-bold text-gray-400 mb-2">오늘</h4>
                <div className="space-y-0.5">
                  <div className="px-2 py-2 text-[14px] font-medium text-gray-700 hover:text-gray-900 cursor-pointer truncate transition-colors">고급 기계학습론 - 5주차</div>
                  <div className="px-2 py-2 text-[14px] font-medium text-gray-700 hover:text-gray-900 cursor-pointer truncate transition-colors">데이터 마이닝 실습</div>
                </div>
              </div>

              <div className="pt-4">
                <h4 className="px-2 text-xs font-bold text-gray-400 mb-2">어제</h4>
                <div className="space-y-0.5">
                  <div className="px-2 py-2 text-[14px] font-medium text-gray-700 hover:text-gray-900 cursor-pointer truncate transition-colors">알고리즘 분석 4차</div>
                  <div className="px-2 py-2 text-[14px] font-medium text-gray-700 hover:text-gray-900 cursor-pointer truncate transition-colors">인공지능 윤리 토론</div>
                </div>
              </div>

              <div className="pt-4">
                <h4 className="px-2 text-xs font-bold text-gray-400 mb-2">지난 7일</h4>
                <div className="space-y-0.5">
                  <div className="px-2 py-2 text-[14px] font-medium text-gray-700 hover:text-gray-900 cursor-pointer truncate transition-colors">확률과 통계 기초</div>
                  <div className="px-2 py-2 text-[14px] font-medium text-gray-700 hover:text-gray-900 cursor-pointer truncate transition-colors">컴퓨터 비전 입문</div>
                </div>
              </div>
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
            
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setIsAccountMenuOpen((open) => !open);
                  setIsDeleteConfirmOpen(false);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#61efce]/30"
                aria-label="사용자 메뉴 열기"
                aria-expanded={isAccountMenuOpen}
              >
                <UserIcon className="h-4 w-4" />
              </button>

              {isAccountMenuOpen && (
                <div className="absolute right-0 top-12 z-50 w-[320px] rounded-2xl border border-gray-200 bg-white p-3 text-left shadow-[0_24px_70px_-32px_rgba(15,23,42,0.45)]">
                  <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-2 pb-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-gray-400">계정</p>
                      <p className="mt-1 truncate text-sm font-extrabold text-gray-950">{displayName}</p>
                      {user?.email && (
                        <p className="mt-0.5 truncate text-xs font-medium text-gray-500">{user.email}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsAccountMenuOpen(false);
                        setIsDeleteConfirmOpen(false);
                      }}
                      className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900"
                      aria-label="사용자 메뉴 닫기"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="space-y-1 py-2">
                    <button
                      type="button"
                      onClick={handleLogout}
                      disabled={isAccountActionPending}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold text-gray-700 transition-colors hover:bg-gray-50 hover:text-gray-950 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <LogOut className="h-4 w-4" />
                      로그아웃
                    </button>

                    {!isDeleteConfirmOpen ? (
                      <button
                        type="button"
                        onClick={() => setIsDeleteConfirmOpen(true)}
                        disabled={isAccountActionPending}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold text-[#ba1a1a] transition-colors hover:bg-[#ffdad6]/55 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <UserX className="h-4 w-4" />
                        계정 탈퇴
                      </button>
                    ) : (
                      <div className="rounded-xl border border-[#ffb4ab] bg-[#fff7f6] p-3">
                        <p className="text-sm font-extrabold text-[#93000a]">계정을 탈퇴할까요?</p>
                        <p className="mt-1 text-xs font-medium leading-5 text-[#7a271f]">
                          계정과 저장된 세션 정보가 삭제됩니다.
                        </p>
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={() => setIsDeleteConfirmOpen(false)}
                            disabled={isAccountActionPending}
                            className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-extrabold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            취소
                          </button>
                          <button
                            type="button"
                            onClick={handleWithdrawAccount}
                            disabled={isAccountActionPending}
                            className="flex-1 rounded-lg bg-[#ba1a1a] px-3 py-2 text-xs font-extrabold text-white transition-colors hover:bg-[#9f1616] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            탈퇴하기
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </header>

          <div className="flex-1 overflow-y-auto">
            {children}
          </div>
        </main>
      </div>
    </ProtectedRoute>
  );
}
