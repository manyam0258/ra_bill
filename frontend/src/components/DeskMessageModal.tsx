import { useEffect, useRef } from "react";
import { AlertCircle, AlertTriangle, Info, X } from "lucide-react";

export interface DeskMessageModalProps {
	title: string;
	message: string;
	indicator?: "red" | "orange" | "blue" | "green" | string;
	onClose: () => void;
}

export function DeskMessageModal({
	title,
	message,
	indicator = "red",
	onClose,
}: DeskMessageModalProps) {
	const closeButtonRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		closeButtonRef.current?.focus();
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [onClose]);

	const getIcon = () => {
		switch (indicator) {
			case "orange":
			case "yellow":
				return <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />;
			case "blue":
				return <Info className="w-5 h-5 text-indigo-600 dark:text-[#7367f0] shrink-0" />;
			case "green":
				return <Info className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />;
			case "red":
			default:
				return <AlertCircle className="w-5 h-5 text-rose-600 dark:text-[#ea5455] shrink-0" />;
		}
	};

	const getIconBg = () => {
		switch (indicator) {
			case "orange":
			case "yellow":
				return "bg-amber-500/10 border-amber-500/20";
			case "blue":
				return "bg-indigo-500/10 border-indigo-500/20";
			case "green":
				return "bg-emerald-500/10 border-emerald-500/20";
			case "red":
			default:
				return "bg-rose-500/10 border-rose-500/20";
		}
	};

	return (
		<div
			className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-200"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div
				role="dialog"
				aria-modal="true"
				className="bg-white dark:bg-[#232333] border border-slate-200 dark:border-[#32344d] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[85vh] transition-all"
			>
				{/* Modal Header */}
				<div className="p-5 border-b border-slate-200/80 dark:border-[#32344d] flex items-center justify-between gap-3">
					<div className="flex items-center gap-3">
						<div className={`p-2 rounded-xl border ${getIconBg()} flex items-center justify-center`}>
							{getIcon()}
						</div>
						<div>
							<h3 className="font-bold text-base text-slate-900 dark:text-slate-100 leading-snug">
								{title || "Validation Message"}
							</h3>
						</div>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="p-2 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 rounded-xl hover:bg-slate-100 dark:hover:bg-[#282a42] transition cursor-pointer"
						title="Close dialog"
					>
						<X className="w-5 h-5" />
					</button>
				</div>

				{/* Modal Body */}
				<div className="p-6 overflow-y-auto max-h-[60vh] space-y-3">
					<p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-line font-medium">
						{message}
					</p>
				</div>

				{/* Modal Footer */}
				<div className="p-4 bg-slate-50/70 dark:bg-[#1e1e2d]/60 border-t border-slate-200/80 dark:border-[#32344d] flex justify-end">
					<button
						ref={closeButtonRef}
						type="button"
						onClick={onClose}
						className="px-5 py-2.5 bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white text-white dark:text-slate-900 rounded-xl font-bold text-xs shadow-sm transition cursor-pointer"
					>
						Close
					</button>
				</div>
			</div>
		</div>
	);
}
