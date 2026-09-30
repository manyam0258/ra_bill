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
				className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-[#0B132B] hover:bg-slate-100 dark:hover:bg-[#111A30] border border-slate-200/80 dark:border-white/[0.06] cursor-pointer transition select-none"
			>
				<div className="flex items-center gap-3 overflow-hidden">
					<div className="w-8 h-8 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-600 text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-md shadow-cyan-900/30">
						{userInitials}
					</div>
					<div className="truncate">
						<p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
							{currentUser || "Administrator"}
						</p>
						<p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium truncate">
							Quantity Surveyor
						</p>
					</div>
				</div>
				<div className="text-slate-400 dark:text-slate-400 ml-2 shrink-0">
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
					className={`absolute left-0 w-64 bg-white dark:bg-[#111A30] border border-slate-200 dark:border-white/[0.08] rounded-2xl shadow-2xl backdrop-blur-md py-2 z-50 animate-fadeIn text-xs ${
						align === "up" ? "bottom-full mb-2" : "top-full mt-2"
					}`}
				>
					{/* Dropdown Header User Info */}
					<div className="px-4 py-3 border-b border-slate-100 dark:border-white/[0.06] bg-slate-50/50 dark:bg-[#0B132B]/80">
						<p className="font-bold text-slate-900 dark:text-slate-100 text-xs">
							{currentUser || "Administrator"}
						</p>
						<p className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
							Connected to frappe.local
						</p>
					</div>

					{/* Menu Items */}
					<div className="py-1">
						<a
							href="/me"
							className="group flex items-center gap-3 px-4 py-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-cyan-500/10 hover:text-cyan-600 dark:hover:text-cyan-400 font-semibold transition"
						>
							<User size={16} className="text-slate-400 dark:text-slate-400 group-hover:text-cyan-400 shrink-0 transition-colors" />
							<span>View Profile</span>
						</a>

						<a
							href="/apps"
							className="group flex items-center gap-3 px-4 py-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-cyan-500/10 hover:text-cyan-600 dark:hover:text-cyan-400 font-semibold transition"
						>
							<LayoutGrid size={16} className="text-slate-400 dark:text-slate-400 group-hover:text-cyan-400 shrink-0 transition-colors" />
							<span>Apps</span>
						</a>

						<a
							href="/app"
							className="group flex items-center gap-3 px-4 py-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-cyan-500/10 hover:text-cyan-600 dark:hover:text-cyan-400 font-semibold transition"
						>
							<AppWindow size={16} className="text-slate-400 dark:text-slate-400 group-hover:text-cyan-400 shrink-0 transition-colors" />
							<span>Switch to Desk</span>
						</a>
					</div>

					{/* Sign Out Action */}
					<div className="pt-1 border-t border-slate-100 dark:border-white/[0.06]">
						<button
							onClick={handleSignOut}
							className="w-full flex items-center gap-3 px-4 py-2.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/15 font-bold transition text-left cursor-pointer"
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
