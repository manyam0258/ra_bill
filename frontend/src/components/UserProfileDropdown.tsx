import { useState, useRef, useEffect } from "react";
import { useFrappeAuth } from "frappe-react-sdk";
import { User, LayoutGrid, AppWindow, LogOut, ChevronDown, ChevronUp } from "lucide-react";

interface UserProfileDropdownProps {
	align?: "up" | "down";
}

export function UserProfileDropdown({ align = "up" }: UserProfileDropdownProps) {
	const [isOpen, setIsOpen] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const { currentUser, logout } = useFrappeAuth();

	useEffect(() => {
		function handleClickOutside(event: MouseEvent) {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
				setIsOpen(false);
			}
		}
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	const handleSignOut = async () => {
		try {
			await fetch("/api/method/logout", {
				method: "POST",
				headers: {
					"X-Frappe-CSRF-Token": (window as any).frappe?.csrf_token || (window as any).csrf_token || "",
				},
				credentials: "include",
			});
			if (logout) await logout();
		} catch (err) {
			console.error("Sign out error:", err);
		} finally {
			localStorage.removeItem("user_id");
			sessionStorage.clear();
			window.location.href = "/login";
		}
	};

	const userInitials = currentUser ? currentUser.substring(0, 2).toUpperCase() : "AD";

	return (
		<div className="relative" ref={dropdownRef}>
			{/* TRIGGER CARD */}
			<div
				onClick={() => setIsOpen(!isOpen)}
				className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-[#232333] hover:bg-slate-100 dark:hover:bg-[#282a42] border border-slate-200/80 dark:border-[#32344d] cursor-pointer transition select-none"
			>
				<div className="flex items-center gap-3 overflow-hidden">
					<div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-600 dark:from-[#7367f0] to-purple-500 text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-md">
						{userInitials}
					</div>
					<div className="truncate">
						<p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
							{currentUser || "Administrator"}
						</p>
						<p className="text-[10px] text-slate-500 dark:text-[#8f93a7] font-medium truncate">
							Quantity Surveyor
						</p>
					</div>
				</div>
				<div className="text-slate-400 dark:text-[#8f93a7] ml-2 shrink-0">
					{align === "up" ? (
						isOpen ? <ChevronDown size={15} /> : <ChevronUp size={15} />
					) : (
						isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />
					)}
				</div>
			</div>

			{/* FLOATING DROPDOWN CARD */}
			{isOpen && (
				<div
					className={`absolute left-0 w-64 bg-white dark:bg-[#1e1e2d] border border-slate-200 dark:border-[#32344d] rounded-2xl shadow-2xl py-2 z-50 animate-fadeIn text-xs ${
						align === "up" ? "bottom-full mb-2" : "top-full mt-2"
					}`}
				>
					{/* Dropdown Header User Info */}
					<div className="px-4 py-3 border-b border-slate-100 dark:border-[#2d2d3f] bg-slate-50/50 dark:bg-[#232333]/50">
						<p className="font-bold text-slate-900 dark:text-slate-100 text-xs">
							{currentUser || "Administrator"}
						</p>
						<p className="text-[10px] text-slate-500 dark:text-[#8f93a7] truncate mt-0.5">
							Connected to frappe.local
						</p>
					</div>

					{/* Menu Items */}
					<div className="py-1">
						<a
							href="/me"
							className="flex items-center gap-3 px-4 py-2.5 text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-[#282a42] hover:text-indigo-600 dark:hover:text-[#7367f0] font-semibold transition"
						>
							<User size={16} className="text-slate-400 dark:text-[#8f93a7] shrink-0" />
							<span>View Profile</span>
						</a>

						<a
							href="/apps"
							className="flex items-center gap-3 px-4 py-2.5 text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-[#282a42] hover:text-indigo-600 dark:hover:text-[#7367f0] font-semibold transition"
						>
							<LayoutGrid size={16} className="text-slate-400 dark:text-[#8f93a7] shrink-0" />
							<span>Apps</span>
						</a>

						<a
							href="/app"
							className="flex items-center gap-3 px-4 py-2.5 text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-[#282a42] hover:text-indigo-600 dark:hover:text-[#7367f0] font-semibold transition"
						>
							<AppWindow size={16} className="text-slate-400 dark:text-[#8f93a7] shrink-0" />
							<span>Switch to Desk</span>
						</a>
					</div>

					{/* Sign Out Action */}
					<div className="pt-1 border-t border-slate-100 dark:border-[#2d2d3f]">
						<button
							onClick={handleSignOut}
							className="w-full flex items-center gap-3 px-4 py-2.5 text-rose-600 dark:text-[#ea5455] hover:bg-rose-50 dark:hover:bg-[#ea5455]/15 font-bold transition text-left"
						>
							<LogOut size={16} className="shrink-0" />
							<span>Sign Out</span>
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
