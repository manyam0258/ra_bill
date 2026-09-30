import { useEffect } from "react";
import { ItemLinkDropdown } from "./ItemLinkDropdown";
import {
	Trash2,
	Copy,
	X,
	Check,
	ArrowUp,
	ArrowDown,
} from "lucide-react";

export interface RowEditorModalProps {
	rowIndex: number;
	totalRows: number;
	mode: "wo" | "bill";
	row: any;
	onChange: (updatedRow: any) => void;
	onDelete: () => void;
	onInsertAbove: () => void;
	onInsertBelow: () => void;
	onDuplicate: () => void;
	onClose: () => void;
}

export function RowEditorModal({
	rowIndex,
	totalRows,
	mode,
	row,
	onChange,
	onDelete,
	onInsertAbove,
	onInsertBelow,
	onDuplicate,
	onClose,
}: RowEditorModalProps) {

	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") {
				onClose();
			}
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [onClose]);

	const handleFieldChange = (field: string, value: any) => {
		const updated = { ...row, [field]: value };
		if (mode === "wo") {
			if (field === "qty" || field === "rate") {
				updated.amount = Number(updated.qty || 0) * Number(updated.rate || 0);
			}
		} else {
			if (field === "this_bill_qty" || field === "rate" || field === "reject_qty" || field === "hold_qty") {
				const thisBillQty = Number(updated.this_bill_qty || 0);
				const rejectQty = Number(updated.reject_qty || 0);
				const approvedQty = Math.max(0, thisBillQty - rejectQty);
				const rate = Number(updated.rate || 0);
				const prevQty = Number(updated.previous_qty || 0);
				updated.approved_qty = approvedQty;
				updated.cumulative_qty = prevQty + approvedQty;
				updated.current_qty = thisBillQty;
				updated.this_bill_amount = approvedQty * rate;
				updated.current_amount = approvedQty * rate;
				updated.amount = updated.this_bill_amount;
			}
		}
		onChange(updated);
	};

	const handleItemSelect = (item: { item_code: string; description: string; uom: string }) => {
		const updated = {
			...row,
			item_code: item.item_code,
			description: item.description || row.description,
			uom: item.uom || row.uom || "Nos",
		};
		onChange(updated);
	};

	return (
		<div className="bg-[#111A30] border-2 border-cyan-500/40 rounded-2xl p-6 shadow-2xl shadow-cyan-950/40 space-y-6 my-4 transition-all animate-fadeIn backdrop-blur-md">
			{/* A. TOP ACTION TOOLBAR */}
			<div className="flex flex-wrap items-center justify-between border-b border-slate-800 pb-4 gap-4">
				<div className="flex items-center gap-3">
					<span className="w-8 h-8 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white flex items-center justify-center font-bold text-xs shadow-md shadow-cyan-900/40">
						#{rowIndex + 1}
					</span>
					<div>
						<h4 className="font-bold text-sm text-slate-100">
							Editing Row #{rowIndex + 1} of {totalRows}
						</h4>
						<p className="text-[11px] text-slate-400">
							Configure item code, quantities, rates, and accounting dimensions
						</p>
					</div>
				</div>

				<div className="flex flex-wrap items-center gap-2 text-xs">
					<button
						type="button"
						onClick={onInsertAbove}
						className="px-3 py-1.5 bg-[#0E1726] hover:bg-slate-800 text-slate-300 border border-slate-700/60 rounded-xl font-semibold transition flex items-center gap-1 cursor-pointer"
					>
						<ArrowUp size={14} /> Insert Above
					</button>

					<button
						type="button"
						onClick={onInsertBelow}
						className="px-3 py-1.5 bg-[#0E1726] hover:bg-slate-800 text-slate-300 border border-slate-700/60 rounded-xl font-semibold transition flex items-center gap-1 cursor-pointer"
					>
						<ArrowDown size={14} /> Insert Below
					</button>

					<button
						type="button"
						onClick={onDuplicate}
						className="px-3 py-1.5 bg-[#0E1726] hover:bg-slate-800 text-slate-300 border border-slate-700/60 rounded-xl font-semibold transition flex items-center gap-1 cursor-pointer"
					>
						<Copy size={14} /> Duplicate
					</button>

					<button
						type="button"
						onClick={onDelete}
						className="px-3 py-1.5 bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30 rounded-xl font-semibold transition flex items-center gap-1 cursor-pointer"
					>
						<Trash2 size={14} /> Delete Row
					</button>

					<button
						type="button"
						onClick={onClose}
						className="p-1.5 bg-[#0E1726] hover:bg-slate-800 text-slate-300 border border-slate-700/60 rounded-xl transition cursor-pointer"
						title="Close Row Editor"
					>
						<X size={16} />
					</button>
				</div>
			</div>

			{/* B. ROW FIELDS GRID */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
				{/* Left Column */}
				<div className="space-y-4">
					<div>
						<label className="block font-bold text-slate-300 mb-1.5">
							Item (ERPNext Item Link) *
						</label>
						<ItemLinkDropdown
							value={row.item_code || ""}
							onChange={handleItemSelect}
						/>
					</div>

					<div>
						<label className="block font-bold text-slate-300 mb-1.5">
							Description *
						</label>
						<textarea
							rows={3}
							value={row.description || ""}
							onChange={(e) => handleFieldChange("description", e.target.value)}
							placeholder="Detailed scope of work / item specifications..."
							className="w-full p-2.5 bg-[#0E1726] border border-slate-700/60 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-500/20"
						/>
					</div>

					<div>
						<label className="block font-bold text-slate-300 mb-1.5">
							Cost Code / WBS Reference
						</label>
						<input
							type="text"
							value={row.cost_center || row.wbs_code || ""}
							onChange={(e) => handleFieldChange("cost_center", e.target.value)}
							placeholder="e.g. CC-CIVIL-01"
							className="w-full p-2.5 bg-[#0E1726] border border-slate-700/60 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-500/20"
						/>
					</div>
				</div>

				{/* Right Column */}
				<div className="space-y-4">
					<div>
						<label className="block font-bold text-slate-300 mb-1.5">
							Unit of Measure (UOM) *
						</label>
						<input
							type="text"
							value={row.uom || "Nos"}
							onChange={(e) => handleFieldChange("uom", e.target.value)}
							placeholder="e.g. Cum, Sqm, Nos, MT"
							className="w-full p-2.5 bg-[#0E1726] border border-slate-700/60 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-500/20"
						/>
					</div>

					{mode === "wo" ? (
						<>
							<div>
								<label className="block font-bold text-slate-300 mb-1.5">
									Work Order Quantity *
								</label>
								<input
									type="number"
									step="any"
									value={row.qty === 0 ? "" : (row.qty ?? "")}
									onChange={(e) => handleFieldChange("qty", e.target.value === "" ? 0 : Number(e.target.value))}
									className="w-full p-2.5 bg-[#0E1726] border border-slate-700/60 rounded-xl font-mono text-slate-100 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-500/20"
								/>
							</div>

							<div>
								<label className="block font-bold text-slate-300 mb-1.5">
									Contract Rate (INR) *
								</label>
								<input
									type="number"
									step="any"
									value={row.rate === 0 ? "" : (row.rate ?? "")}
									onChange={(e) => handleFieldChange("rate", e.target.value === "" ? 0 : Number(e.target.value))}
									className="w-full p-2.5 bg-[#0E1726] border border-slate-700/60 rounded-xl font-mono text-slate-100 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-500/20"
								/>
							</div>

							<div className="p-3 bg-cyan-500/10 rounded-xl border border-cyan-500/30 flex justify-between items-center">
								<span className="font-bold text-cyan-400">Line Amount (INR):</span>
								<span className="font-mono font-black text-cyan-300 text-sm">
									₹ {(Number(row.qty || 0) * Number(row.rate || 0)).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
								</span>
							</div>
						</>
					) : (
						<>
							<div className="grid grid-cols-3 gap-3">
								<div>
									<label className="block font-bold text-slate-400 mb-1.5">
										Work Order Qty
									</label>
									<input
										type="number"
										value={row.boq_qty ?? 0}
										readOnly
										className="w-full p-2.5 bg-[#0E1726]/60 border border-slate-800 rounded-xl font-mono text-slate-400 cursor-not-allowed"
									/>
								</div>

								<div>
									<label className="block font-bold text-slate-300 mb-1.5">
										Contract Rate (INR)
									</label>
									<input
										type="number"
										step="any"
										value={row.rate === 0 ? "" : (row.rate ?? "")}
										onChange={(e) => handleFieldChange("rate", e.target.value === "" ? 0 : Number(e.target.value))}
										className="w-full p-2.5 bg-[#0E1726] border border-slate-700/60 rounded-xl font-mono text-slate-100 focus:outline-none focus:border-cyan-400"
									/>
								</div>

								<div>
									<label className="block font-bold text-slate-400 mb-1.5">
										Previous Billed Qty
									</label>
									<input
										type="number"
										value={row.previous_qty || 0}
										readOnly
										className="w-full p-2.5 bg-[#0E1726]/60 border border-slate-800 rounded-xl font-mono text-slate-400 cursor-not-allowed"
									/>
								</div>
							</div>

							<div className="grid grid-cols-2 gap-3">
								<div>
									<label className="block font-bold text-cyan-400 mb-1.5">
										This Bill Qty *
									</label>
									<input
										type="number"
										step="any"
										value={row.this_bill_qty === 0 ? "" : (row.this_bill_qty ?? "")}
										onChange={(e) => handleFieldChange("this_bill_qty", e.target.value === "" ? 0 : Number(e.target.value))}
										className="w-full p-2.5 bg-[#0E1726] border-2 border-cyan-400/80 rounded-xl font-mono font-bold text-cyan-300 focus:outline-none"
									/>
								</div>

								<div>
									<label className="block font-bold text-rose-400 mb-1.5">
										Reject Qty
									</label>
									<input
										type="number"
										step="any"
										value={row.reject_qty === 0 ? "" : (row.reject_qty ?? "")}
										onChange={(e) => handleFieldChange("reject_qty", e.target.value === "" ? 0 : Number(e.target.value))}
										placeholder="0"
										className="w-full p-2.5 bg-[#0E1726] border border-rose-500/40 rounded-xl font-mono font-bold text-rose-400 focus:outline-none focus:border-rose-400"
									/>
									{Number(row.reject_qty || 0) > Number(row.this_bill_qty || 0) && (
										<p className="text-[10px] text-rose-400 font-bold mt-1">Cannot exceed This Bill Qty ({row.this_bill_qty || 0})</p>
									)}
								</div>
							</div>

							<div className="grid grid-cols-3 gap-3">
								<div>
									<label className="block font-bold text-emerald-400 mb-1.5">
										Approved Qty
									</label>
									<input
										type="number"
										value={Math.max(0, Number(row.this_bill_qty || 0) - Number(row.reject_qty || 0))}
										readOnly
										disabled
										className="w-full p-2.5 bg-emerald-950/20 border border-emerald-800/40 rounded-xl font-mono font-bold text-emerald-400 cursor-not-allowed"
									/>
								</div>

								<div>
									<label className="block font-bold text-amber-400 mb-1.5">
										Hold Qty
									</label>
									<input
										type="number"
										step="any"
										value={row.hold_qty === 0 ? "" : (row.hold_qty ?? "")}
										onChange={(e) => handleFieldChange("hold_qty", e.target.value === "" ? 0 : Number(e.target.value))}
										placeholder="0"
										className="w-full p-2.5 bg-[#0E1726] border border-amber-500/40 rounded-xl font-mono font-bold text-amber-400 focus:outline-none focus:border-amber-400"
									/>
									{Number(row.hold_qty || 0) > Math.max(0, Number(row.this_bill_qty || 0) - Number(row.reject_qty || 0)) && (
										<p className="text-[10px] text-amber-400 font-bold mt-1">Cannot exceed Approved Qty ({Math.max(0, Number(row.this_bill_qty || 0) - Number(row.reject_qty || 0))})</p>
									)}
								</div>

								<div>
									<label className="block font-bold text-slate-300 mb-1.5">
										Cumulative Qty
									</label>
									<input
										type="number"
										value={(Number(row.previous_qty || 0) + Math.max(0, Number(row.this_bill_qty || 0) - Number(row.reject_qty || 0)))}
										readOnly
										disabled
										className="w-full p-2.5 bg-[#0E1726]/60 border border-slate-800 rounded-xl font-mono text-slate-300 cursor-not-allowed opacity-90"
									/>
								</div>
							</div>

							<div className="p-3.5 bg-cyan-500/10 rounded-xl border border-cyan-500/30 flex justify-between items-center">
								<div>
									<span className="font-bold text-cyan-400">This Bill Amount (INR):</span>
									<span className="text-[10px] text-slate-400 block">Approved Qty × Rate</span>
								</div>
								<span className="font-mono font-black text-cyan-300 text-sm">
									₹ {(Math.max(0, Number(row.this_bill_qty || 0) - Number(row.reject_qty || 0)) * Number(row.rate || 0)).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
								</span>
							</div>
						</>
					)}
				</div>
			</div>

			{/* C. BOTTOM SHORTCUTS & ACTIONS */}
			<div className="flex flex-wrap items-center justify-between border-t border-slate-800 pt-4 gap-4 text-xs">
				<div className="text-slate-400 font-mono text-[11px]">
					Shortcuts: <kbd className="px-1.5 py-0.5 bg-[#0E1726] border border-slate-700/60 text-slate-300 rounded">ESC</kbd> Close
				</div>

				<div className="flex gap-2">
					<button
						type="button"
						onClick={onInsertBelow}
						className="px-4 py-2 bg-[#0E1726] hover:bg-slate-800 text-slate-300 border border-slate-700/60 font-semibold rounded-xl transition cursor-pointer"
					>
						+ Insert Below
					</button>

					<button
						type="button"
						onClick={onClose}
						className="px-5 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold rounded-xl shadow-md shadow-cyan-900/40 hover:shadow-cyan-500/30 transition flex items-center gap-1.5 cursor-pointer"
					>
						<Check size={16} />
						<span>Done Editing</span>
					</button>
				</div>
			</div>
		</div>
	);
}
