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
			if (field === "this_bill_qty" || field === "rate") {
				const thisBillQty = Number(updated.this_bill_qty || 0);
				const rate = Number(updated.rate || 0);
				const prevQty = Number(updated.previous_qty || 0);
				updated.this_bill_amount = thisBillQty * rate;
				updated.cumulative_qty = prevQty + thisBillQty;
				updated.current_qty = thisBillQty;
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
		<div className="bg-slate-50 dark:bg-[#1e1e2d] border-2 border-indigo-500/50 dark:border-[#7367f0] rounded-2xl p-6 shadow-2xl space-y-6 my-4 transition-all animate-fadeIn">
			{/* A. TOP ACTION TOOLBAR */}
			<div className="flex flex-wrap items-center justify-between border-b border-slate-200 dark:border-[#32344d] pb-4 gap-4">
				<div className="flex items-center gap-3">
					<span className="w-8 h-8 rounded-xl bg-indigo-600 dark:bg-[#7367f0] text-white flex items-center justify-center font-bold text-xs">
						#{rowIndex + 1}
					</span>
					<div>
						<h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">
							Editing Row #{rowIndex + 1} of {totalRows}
						</h4>
						<p className="text-[11px] text-slate-500 dark:text-[#8f93a7]">
							Configure item code, quantities, rates, and accounting dimensions
						</p>
					</div>
				</div>

				<div className="flex flex-wrap items-center gap-2 text-xs">
					<button
						type="button"
						onClick={onInsertAbove}
						className="px-3 py-1.5 bg-white dark:bg-[#232333] hover:bg-slate-100 dark:hover:bg-[#282a42] text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-[#32344d] rounded-xl font-semibold transition flex items-center gap-1"
					>
						<ArrowUp size={14} /> Insert Above
					</button>

					<button
						type="button"
						onClick={onInsertBelow}
						className="px-3 py-1.5 bg-white dark:bg-[#232333] hover:bg-slate-100 dark:hover:bg-[#282a42] text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-[#32344d] rounded-xl font-semibold transition flex items-center gap-1"
					>
						<ArrowDown size={14} /> Insert Below
					</button>

					<button
						type="button"
						onClick={onDuplicate}
						className="px-3 py-1.5 bg-white dark:bg-[#232333] hover:bg-slate-100 dark:hover:bg-[#282a42] text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-[#32344d] rounded-xl font-semibold transition flex items-center gap-1"
					>
						<Copy size={14} /> Duplicate
					</button>

					<button
						type="button"
						onClick={onDelete}
						className="px-3 py-1.5 bg-rose-500/15 hover:bg-rose-500/25 text-rose-600 dark:text-[#ea5455] border border-rose-500/30 rounded-xl font-semibold transition flex items-center gap-1"
					>
						<Trash2 size={14} /> Delete Row
					</button>

					<button
						type="button"
						onClick={onClose}
						className="p-1.5 bg-slate-200 dark:bg-[#282a42] hover:bg-slate-300 dark:hover:bg-[#32344d] text-slate-700 dark:text-slate-200 rounded-xl transition"
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
						<label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5">
							Item (ERPNext Item Link) *
						</label>
						<ItemLinkDropdown
							value={row.item_code || ""}
							onChange={handleItemSelect}
						/>
					</div>

					<div>
						<label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5">
							Description *
						</label>
						<textarea
							rows={3}
							value={row.description || ""}
							onChange={(e) => handleFieldChange("description", e.target.value)}
							placeholder="Detailed scope of work / item specifications..."
							className="w-full p-2.5 bg-white dark:bg-[#232333] border border-slate-200 dark:border-[#32344d] rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-600 dark:focus:border-[#7367f0]"
						/>
					</div>

					<div>
						<label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5">
							Cost Code / WBS Reference
						</label>
						<input
							type="text"
							value={row.cost_center || row.wbs_code || ""}
							onChange={(e) => handleFieldChange("cost_center", e.target.value)}
							placeholder="e.g. CC-CIVIL-01"
							className="w-full p-2.5 bg-white dark:bg-[#232333] border border-slate-200 dark:border-[#32344d] rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-600 dark:focus:border-[#7367f0]"
						/>
					</div>
				</div>

				{/* Right Column */}
				<div className="space-y-4">
					<div>
						<label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5">
							Unit of Measure (UOM) *
						</label>
						<input
							type="text"
							value={row.uom || "Nos"}
							onChange={(e) => handleFieldChange("uom", e.target.value)}
							placeholder="e.g. Cum, Sqm, Nos, MT"
							className="w-full p-2.5 bg-white dark:bg-[#232333] border border-slate-200 dark:border-[#32344d] rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-600 dark:focus:border-[#7367f0]"
						/>
					</div>

					{mode === "wo" ? (
						<>
							<div>
								<label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5">
									Work Order Quantity *
								</label>
								<input
									type="number"
									step="any"
									value={row.qty === 0 ? "" : (row.qty ?? "")}
									onChange={(e) => handleFieldChange("qty", e.target.value === "" ? 0 : Number(e.target.value))}
									className="w-full p-2.5 bg-white dark:bg-[#232333] border border-slate-200 dark:border-[#32344d] rounded-xl font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-600 dark:focus:border-[#7367f0]"
								/>
							</div>

							<div>
								<label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5">
									Contract Rate (INR) *
								</label>
								<input
									type="number"
									step="any"
									value={row.rate === 0 ? "" : (row.rate ?? "")}
									onChange={(e) => handleFieldChange("rate", e.target.value === "" ? 0 : Number(e.target.value))}
									className="w-full p-2.5 bg-white dark:bg-[#232333] border border-slate-200 dark:border-[#32344d] rounded-xl font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-600 dark:focus:border-[#7367f0]"
								/>
							</div>

							<div className="p-3 bg-indigo-50 dark:bg-[#7367f0]/15 rounded-xl border border-indigo-200 dark:border-[#7367f0]/30 flex justify-between items-center">
								<span className="font-bold text-indigo-700 dark:text-[#7367f0]">Line Amount (INR):</span>
								<span className="font-mono font-black text-indigo-900 dark:text-[#7367f0] text-sm">
									₹ {(Number(row.qty || 0) * Number(row.rate || 0)).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
								</span>
							</div>
						</>
					) : (
						<>
							<div className="grid grid-cols-3 gap-3">
								<div>
									<label className="block font-bold text-slate-500 dark:text-[#8f93a7] mb-1.5">
										Work Order Qty
									</label>
									<input
										type="number"
										value={row.boq_qty ?? 0}
										readOnly
										className="w-full p-2.5 bg-slate-100 dark:bg-[#1e1e2d] border border-slate-200 dark:border-[#2d2d3f] rounded-xl font-mono text-slate-500 cursor-not-allowed"
									/>
								</div>

								<div>
									<label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5">
										Contract Rate (INR)
									</label>
									<input
										type="number"
										step="any"
										value={row.rate === 0 ? "" : (row.rate ?? "")}
										onChange={(e) => handleFieldChange("rate", e.target.value === "" ? 0 : Number(e.target.value))}
										className="w-full p-2.5 bg-white dark:bg-[#232333] border border-slate-200 dark:border-[#32344d] rounded-xl font-mono text-slate-900 dark:text-slate-100"
									/>
								</div>

								<div>
									<label className="block font-bold text-slate-500 dark:text-[#8f93a7] mb-1.5">
										Previous Billed Qty
									</label>
									<input
										type="number"
										value={row.previous_qty || 0}
										readOnly
										className="w-full p-2.5 bg-slate-100 dark:bg-[#1e1e2d] border border-slate-200 dark:border-[#2d2d3f] rounded-xl font-mono text-slate-500 cursor-not-allowed"
									/>
								</div>
							</div>

							<div className="grid grid-cols-2 gap-3">
								<div>
									<label className="block font-bold text-indigo-600 dark:text-[#7367f0] mb-1.5">
										This Bill Qty *
									</label>
									<input
										type="number"
										step="any"
										value={row.this_bill_qty === 0 ? "" : (row.this_bill_qty ?? "")}
										onChange={(e) => handleFieldChange("this_bill_qty", e.target.value === "" ? 0 : Number(e.target.value))}
										className="w-full p-2.5 bg-white dark:bg-[#232333] border-2 border-indigo-500/60 dark:border-[#7367f0] rounded-xl font-mono font-bold text-indigo-600 dark:text-[#7367f0] focus:outline-none"
									/>
								</div>

								<div>
									<label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5">
										Cumulative Qty (Auto-Sum)
									</label>
									<input
										type="number"
										value={(Number(row.previous_qty || 0) + Number(row.this_bill_qty || 0))}
										readOnly
										disabled
										className="w-full p-2.5 bg-slate-100 dark:bg-[#1e1e2d] border border-slate-200 dark:border-[#2d2d3f] rounded-xl font-mono text-slate-700 dark:text-slate-300 cursor-not-allowed opacity-90"
									/>
								</div>
							</div>

							<div className="p-3.5 bg-indigo-50 dark:bg-[#7367f0]/15 rounded-xl border border-indigo-200 dark:border-[#7367f0]/40 flex justify-between items-center">
								<span className="font-bold text-indigo-700 dark:text-[#7367f0]">This Bill Amount (INR):</span>
								<span className="font-mono font-black text-indigo-900 dark:text-[#7367f0] text-sm">
									₹ {(Number(row.this_bill_qty || 0) * Number(row.rate || 0)).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
								</span>
							</div>
						</>
					)}
				</div>
			</div>

			{/* C. BOTTOM SHORTCUTS & ACTIONS */}
			<div className="flex flex-wrap items-center justify-between border-t border-slate-200 dark:border-[#32344d] pt-4 gap-4 text-xs">
				<div className="text-slate-400 dark:text-[#8f93a7] font-mono text-[11px]">
					Shortcuts: <kbd className="px-1.5 py-0.5 bg-slate-200 dark:bg-[#282a42] rounded">ESC</kbd> Close
				</div>

				<div className="flex gap-2">
					<button
						type="button"
						onClick={onInsertBelow}
						className="px-4 py-2 bg-slate-200 dark:bg-[#282a42] hover:bg-slate-300 dark:hover:bg-[#32344d] text-slate-800 dark:text-slate-200 font-semibold rounded-xl transition"
					>
						+ Insert Below
					</button>

					<button
						type="button"
						onClick={onClose}
						className="px-5 py-2 bg-indigo-600 dark:bg-[#7367f0] hover:bg-indigo-700 dark:hover:bg-[#685dd8] text-white font-bold rounded-xl shadow-md transition flex items-center gap-1.5"
					>
						<Check size={16} />
						<span>Done Editing</span>
					</button>
				</div>
			</div>
		</div>
	);
}
