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
				return <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />;
			case "blue":
				return <Info className="w-5 h-5 text-cyan-400 shrink-0" />;
			case "green":
				return <Info className="w-5 h-5 text-emerald-400 shrink-0" />;
			case "red":
			default:
				return <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />;
		}
	};

	const getIconBg = () => {
		switch (indicator) {
			case "orange":
			case "yellow":
				return "bg-amber-500/10 border-amber-500/20";
			case "blue":
				return "bg-cyan-500/10 border-cyan-500/20";
			case "green":
				return "bg-emerald-500/10 border-emerald-500/20";
			case "red":
			default:
				return "bg-rose-500/10 border-rose-500/20";
		}
	};

	return (
		<div
			className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div
				role="dialog"
				aria-modal="true"
				className="bg-[#111A30] border border-white/[0.08] rounded-2xl w-full max-w-lg shadow-2xl shadow-cyan-950/40 overflow-hidden flex flex-col max-h-[85vh] transition-all backdrop-blur-md"
			>
				{/* Modal Header */}
				<div className="p-5 border-b border-slate-800 flex items-center justify-between gap-3">
					<div className="flex items-center gap-3">
						<div className={`p-2 rounded-xl border ${getIconBg()} flex items-center justify-center`}>
							{getIcon()}
						</div>
						<div>
							<h3 className="font-bold text-base text-slate-100 leading-snug">
								{title || "Validation Message"}
							</h3>
						</div>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="p-2 text-slate-400 hover:text-slate-200 rounded-xl hover:bg-slate-800 transition cursor-pointer"
						title="Close dialog"
					>
						<X className="w-5 h-5" />
					</button>
				</div>

				{/* Modal Body */}
				<div className="p-6 overflow-y-auto max-h-[60vh] space-y-3">
					<p className="text-sm text-slate-200 leading-relaxed whitespace-pre-line font-medium">
						{message}
					</p>
				</div>

				{/* Modal Footer */}
				<div className="p-4 bg-[#0E1726] border-t border-slate-800 flex justify-end">
					<button
						ref={closeButtonRef}
						type="button"
						onClick={onClose}
						className="px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white rounded-xl font-bold text-xs shadow-md shadow-cyan-900/40 hover:shadow-cyan-500/30 transition cursor-pointer"
					>
						Close
					</button>
				</div>
			</div>
		</div>
	);
}
