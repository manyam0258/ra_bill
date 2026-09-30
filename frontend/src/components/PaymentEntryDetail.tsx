import { useState, useEffect, useCallback } from "react";
import { useFrappeGetDoc } from "frappe-react-sdk";
import {
	ArrowLeft,
	Printer,
	ChevronLeft,
	ChevronRight,
	Coins,
	CheckSquare,
	Square,
	ChevronDown,
	X,
	ExternalLink,
	Send,
} from "lucide-react";

const formatCurrency = (amount: number | undefined | null, currency = "INR") => {
	if (amount === undefined || amount === null) return "₹0.00";
	const isNegative = amount < 0;
	const formatted = new Intl.NumberFormat("en-IN", {
		style: "currency",
		currency: currency || "INR",
		maximumFractionDigits: 2,
	}).format(Math.abs(amount));
	return isNegative ? `- ${formatted}` : formatted;
};
import { callFrappeMethod, parseFrappeError } from "../utils/frappeErrors";

interface PaymentEntryDetailProps {
	paymentId?: string;
	paymentEntryId?: string;
	onBack: () => void;
	onSelectInvoice?: (invoiceId: string) => void;
	onSelectWO?: (woId: string) => void;
}

export function PaymentEntryDetail({
	paymentId,
	paymentEntryId,
	onBack,
	onSelectInvoice,
	onSelectWO,
}: PaymentEntryDetailProps) {
	const targetId = paymentEntryId || paymentId || "";
	const { data: doc, isLoading, mutate } = useFrappeGetDoc("Payment Entry", targetId);

	// Collapsible sections
	const [isConnectionsOpen, setIsConnectionsOpen] = useState(true);
	const [isAccountsOpen, setIsAccountsOpen] = useState(true);
	const [isReferencesOpen, setIsReferencesOpen] = useState(true);
	const [isDeductionsOpen, setIsDeductionsOpen] = useState(true);
	const [isDimensionsOpen, setIsDimensionsOpen] = useState(true);

	// Ledger Viewer Modal State
	const [isLedgerOpen, setIsLedgerOpen] = useState(false);
	const [glEntries, setGlEntries] = useState<any[]>([]);
	const [isLoadingGL, setIsLoadingGL] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);

	// Submit handler — same pattern as RA Bill / Purchase Invoice submit buttons
	const handleSubmitPE = useCallback(async () => {
		if (isSubmitting || !doc || doc.docstatus !== 0) return;
		setIsSubmitting(true);
		try {
			await callFrappeMethod("ra_bill.api.submit_document", {
				doctype: "Payment Entry",
				name: doc.name,
			});
			mutate();
		} catch (err: any) {
			const parsed = parseFrappeError(err, "Submit Payment Entry Failed");
			alert(parsed.message);
		} finally {
			setIsSubmitting(false);
		}
	}, [isSubmitting, doc, mutate]);

	// Fetch GL Entries when Ledger modal opens
	useEffect(() => {
		if (isLedgerOpen && doc) {
			setIsLoadingGL(true);
			callFrappeMethod("frappe.desk.query_report.run", {
				report_name: "General Ledger",
				filters: {
					voucher_no: doc.name,
					company: doc.company || "Tridasa",
				},
			})
				.then((res) => {
					if (res && res.result) {
						// Filter out total rows if present
						setGlEntries(res.result.filter((r: any) => r.account && !r.is_total_row));
					} else {
						setGlEntries([]);
					}
				})
				.catch(() => {
					// Fallback to direct GL Entry list if query report fails
					fetch(`/api/resource/GL Entry?filters=[["voucher_no","=","${doc.name}"]]&fields=["posting_date","account","debit","credit","voucher_type","voucher_no","against"]`)
						.then((r) => r.json())
						.then((data) => setGlEntries(data.data || []))
						.catch(() => setGlEntries([]));
				})
				.finally(() => setIsLoadingGL(false));
		}
	}, [isLedgerOpen, doc]);

	if (isLoading) {
		return (
			<div className="p-8 space-y-6 animate-pulse">
				<div className="h-16 bg-[#111A30]/90 rounded-2xl border border-white/[0.07]"></div>
				<div className="h-32 bg-[#111A30]/90 rounded-2xl border border-white/[0.07]"></div>
				<div className="h-64 bg-[#111A30]/90 rounded-2xl border border-white/[0.07]"></div>
			</div>
		);
	}

	if (!doc) {
		return (
			<div className="p-12 text-center bg-[#111A30]/90 rounded-2xl border border-rose-500/30 text-rose-400">
				Payment Entry #{paymentId} not found.
			</div>
		);
	}

	const status = doc.status || (doc.docstatus === 1 ? "Submitted" : doc.docstatus === 2 ? "Cancelled" : "Draft");
	const statusBadgeClass =
		status === "Submitted" || status === "Paid"
			? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
			: status === "Cancelled"
			? "bg-rose-500/10 text-rose-400 border-rose-500/30"
			: "bg-amber-500/10 text-amber-400 border-amber-500/30";

	const totalDeductionsAmount = (doc.deductions || []).reduce(
		(acc: number, d: any) => acc + Number(d.amount || 0),
		0
	);

	return (
		<div className="space-y-6 text-slate-100 transition-colors duration-200 pb-12">
			
			{/* A. HEADER & TOP ACTION BAR */}
			<div className="flex flex-wrap items-center justify-between bg-[#111A30]/90 backdrop-blur-md p-5 rounded-2xl border border-white/[0.07] gap-4 shadow-sm">
				<div className="flex items-center gap-4">
					<button
						onClick={onBack}
						className="p-2.5 bg-[#0E1726] hover:bg-slate-800 text-slate-300 rounded-xl border border-slate-800 transition flex items-center gap-2 text-xs font-semibold cursor-pointer"
					>
						<ArrowLeft size={16} />
						<span>Back to Payment Entries</span>
					</button>
					<div>
						<div className="flex items-center gap-2.5">
							<h2 className="text-xl font-bold text-white">
								{doc.party_name || doc.party || doc.name}
							</h2>
							<span className={`px-3 py-0.5 rounded-full text-xs font-bold border ${statusBadgeClass}`}>
								{status}
							</span>
						</div>
						<p className="text-xs text-slate-400 mt-0.5">
							Voucher: <span className="font-mono font-bold text-cyan-400">{doc.name}</span> | Party:{" "}
							<span className="font-bold text-slate-200">{doc.party || "-"}</span>
						</p>
					</div>
				</div>

				{/* Right Action Buttons */}
				<div className="flex flex-wrap items-center gap-2 text-xs">
					{/* Submit Button — visible only for Draft PEs */}
					{doc.docstatus === 0 && (
						<button
							onClick={handleSubmitPE}
							disabled={isSubmitting}
							className="px-5 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-semibold rounded-xl shadow-md shadow-emerald-900/30 transition flex items-center gap-1.5 disabled:opacity-60 cursor-pointer"
						>
							<Send size={15} />
							<span>{isSubmitting ? "Submitting…" : "Submit"}</span>
						</button>
					)}

					{/* Ledger Button */}
					<button
						onClick={() => setIsLedgerOpen(true)}
						className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold rounded-xl shadow-md shadow-cyan-900/40 hover:shadow-cyan-500/30 transition flex items-center gap-1.5 cursor-pointer"
					>
						<Coins size={15} />
						<span>Ledger</span>
					</button>

					<div className="h-5 w-[1px] bg-slate-800 mx-1"></div>

					<button className="p-2 bg-[#0E1726] hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl border border-slate-800 transition cursor-pointer" title="Print">
						<Printer size={15} />
					</button>
					<button className="p-2 bg-[#0E1726] hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl border border-slate-800 transition cursor-pointer" title="Previous">
						<ChevronLeft size={15} />
					</button>
					<button className="p-2 bg-[#0E1726] hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl border border-slate-800 transition cursor-pointer" title="Next">
						<ChevronRight size={15} />
					</button>
				</div>
			</div>

			{/* B. CONNECTIONS (Collapsible) */}
			<div className="bg-[#111A30]/90 backdrop-blur-md border border-white/[0.07] rounded-2xl overflow-hidden shadow-sm">
				<button
					onClick={() => setIsConnectionsOpen(!isConnectionsOpen)}
					className="w-full p-4 flex items-center justify-between font-bold text-xs text-slate-300 bg-[#0E1726]/60 hover:bg-[#0E1726] transition cursor-pointer"
				>
					<span>Connections</span>
					<ChevronDown size={16} className={`transition-transform ${isConnectionsOpen ? "rotate-180" : ""}`} />
				</button>

				{isConnectionsOpen && (
					<div className="p-4 border-t border-slate-800 flex flex-wrap gap-3 text-xs">
						<span className="px-3 py-1.5 bg-[#0E1726] border border-slate-800 rounded-xl text-slate-300 font-medium flex items-center gap-1.5 cursor-pointer hover:border-cyan-500/50">
							<span>Bank Transaction</span>
							<span className="px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-300 text-[10px]">
								{doc.bank_transaction ? "1" : "0"}
							</span>
						</span>
					</div>
				)}
			</div>

			{/* C. SECTION 1: TYPE OF PAYMENT & D. SECTION 2: PAYMENT FROM / TO */}
			<div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
				{/* Type of Payment Card */}
				<div className="bg-[#111A30]/90 backdrop-blur-md border border-white/[0.07] rounded-2xl p-6 shadow-sm space-y-4">
					<h3 className="font-bold text-base text-white border-b border-slate-800 pb-3">
						Type of Payment
					</h3>
					
					<div className="space-y-3">
						<div className="flex justify-between border-b border-slate-800/80 pb-2">
							<span className="text-slate-400">Payment Type:</span>
							<span className="font-bold text-white">{doc.payment_type || "Pay"}</span>
						</div>

						<div className="flex justify-between items-center border-b border-slate-800/80 pb-2">
							<span className="text-slate-400">Is Mobilization Advance:</span>
							<div className="flex items-center gap-1.5 font-semibold text-slate-200">
								{doc.is_mobilization_advance ? (
									<CheckSquare size={16} className="text-cyan-400" />
								) : (
									<Square size={16} className="text-slate-500" />
								)}
								<span>{doc.is_mobilization_advance ? "Yes" : "No"}</span>
							</div>
						</div>

						<div className="flex justify-between items-center border-b border-slate-800/80 pb-2">
							<span className="text-slate-400">Is Ad Hoc Advance:</span>
							<div className="flex items-center gap-1.5 font-semibold text-slate-200">
								{doc.is_adhoc_advance || doc.is_advance ? (
									<CheckSquare size={16} className="text-cyan-400" />
								) : (
									<Square size={16} className="text-slate-500" />
								)}
								<span>{doc.is_adhoc_advance || doc.is_advance ? "Yes" : "No"}</span>
							</div>
						</div>

						<div className="flex justify-between border-b border-slate-800/80 pb-2">
							<span className="text-slate-400">Posting Date:</span>
							<span className="font-semibold text-slate-200">{doc.posting_date}</span>
						</div>

						<div className="flex justify-between border-b border-slate-800/80 pb-2">
							<span className="text-slate-400">Company:</span>
							<span className="font-bold text-white">{doc.company || "Tridasa"}</span>
						</div>

						<div className="flex justify-between">
							<span className="text-slate-400">Mode of Payment:</span>
							<span className="font-semibold text-slate-200">{doc.mode_of_payment || "Bank"}</span>
						</div>
					</div>
				</div>

				{/* Payment Party & Work Order Card */}
				<div className="bg-[#111A30]/90 backdrop-blur-md border border-white/[0.07] rounded-2xl p-6 shadow-sm space-y-4">
					<h3 className="font-bold text-base text-white border-b border-slate-800 pb-3">
						Payment From / To
					</h3>

					<div className="space-y-3">
						<div className="flex justify-between border-b border-slate-800/80 pb-2">
							<span className="text-slate-400">Party Type:</span>
							<span className="font-semibold text-slate-200">{doc.party_type || "Supplier"}</span>
						</div>

						<div className="flex justify-between border-b border-slate-800/80 pb-2">
							<span className="text-slate-400">Party (ID):</span>
							<span className="font-mono font-bold text-cyan-400">{doc.party || "-"}</span>
						</div>

						<div className="flex justify-between border-b border-slate-800/80 pb-2">
							<span className="text-slate-400">Party Name:</span>
							<span className="font-bold text-white">{doc.party_name || doc.party || "-"}</span>
						</div>

						<div className="flex justify-between border-b border-slate-800/80 pb-2">
							<span className="text-slate-400">Linked Work Order:</span>
							{doc.work_order ? (
								<span
									onClick={() => onSelectWO && onSelectWO(doc.work_order)}
									className="font-mono font-bold text-cyan-400 hover:underline cursor-pointer flex items-center gap-1"
								>
									{doc.work_order} <ExternalLink size={12} />
								</span>
							) : (
								<span className="text-slate-500 font-mono">-</span>
							)}
						</div>

						<div className="flex justify-between">
							<span className="text-slate-400">Cheque / Reference No:</span>
							<span className="font-mono font-semibold text-slate-200">{doc.reference_no || "-"}</span>
						</div>
					</div>
				</div>
			</div>

			{/* E. SECTION 3: ACCOUNTS (2-Column Grid) */}
			<div className="bg-[#111A30]/90 backdrop-blur-md border border-white/[0.07] rounded-2xl overflow-hidden shadow-sm space-y-0">
				<button
					onClick={() => setIsAccountsOpen(!isAccountsOpen)}
					className="w-full p-4 flex items-center justify-between font-bold text-xs text-slate-300 bg-[#0E1726]/60 hover:bg-[#0E1726] transition border-b border-slate-800 cursor-pointer"
				>
					<span className="font-bold text-sm text-white">Accounts & Balances</span>
					<ChevronDown size={16} className={`transition-transform ${isAccountsOpen ? "rotate-180" : ""}`} />
				</button>

				{isAccountsOpen && (
					<div className="p-6">
						<div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
							{/* Left: Account Paid From */}
							<div className="bg-[#0E1726]/80 p-5 rounded-xl border border-slate-800/80 space-y-3">
								<h4 className="font-bold text-white border-b border-slate-800 pb-2">
									Account Paid From
								</h4>
								<div className="flex justify-between">
									<span className="text-slate-400">Account Paid From:</span>
									<span className="font-bold text-white">{doc.paid_from || "-"}</span>
								</div>
								<div className="flex justify-between">
									<span className="text-slate-400">Account Currency:</span>
									<span className="font-mono font-semibold text-slate-200">{doc.paid_from_account_currency || "INR"}</span>
								</div>
								<div className="flex justify-between">
									<span className="text-slate-400">Account Balance:</span>
									<span className="font-mono font-bold text-white">{formatCurrency(doc.paid_from_account_balance)}</span>
								</div>
								<div className="flex justify-between pt-2 border-t border-dashed border-slate-800">
									<span className="text-slate-400">Party Balance:</span>
									<span className="font-mono font-bold text-cyan-400">{formatCurrency(doc.party_balance)}</span>
								</div>
							</div>

							{/* Right: Account Paid To */}
							<div className="bg-[#0E1726]/80 p-5 rounded-xl border border-slate-800/80 space-y-3">
								<h4 className="font-bold text-white border-b border-slate-800 pb-2">
									Account Paid To
								</h4>
								<div className="flex justify-between">
									<span className="text-slate-400">Account Paid To:</span>
									<span className="font-bold text-white">{doc.paid_to || "-"}</span>
								</div>
								<div className="flex justify-between">
									<span className="text-slate-400">Account Currency:</span>
									<span className="font-mono font-semibold text-slate-200">{doc.paid_to_account_currency || "INR"}</span>
								</div>
								<div className="flex justify-between">
									<span className="text-slate-400">Account Balance:</span>
									<span className="font-mono font-bold text-white">{formatCurrency(doc.paid_to_account_balance)}</span>
								</div>
							</div>
						</div>
					</div>
				)}
			</div>

			{/* F. SECTION 4: PROMINENT AMOUNT DISPLAY */}
			<div className="bg-gradient-to-r from-cyan-500/10 via-blue-600/10 to-emerald-500/10 border border-cyan-500/30 rounded-2xl p-6 shadow-sm flex flex-wrap items-center justify-between gap-4">
				<div>
					<p className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
						Paid Amount ({doc.paid_from_account_currency || "INR"})
					</p>
					<p className="text-3xl font-black font-mono text-white mt-1">
						{formatCurrency(doc.paid_amount || doc.received_amount)}
					</p>
					{doc.in_words && (
						<p className="text-[11px] text-slate-400 mt-1 italic">
							In Words: {doc.in_words}
						</p>
					)}
				</div>

				<div className="flex items-center gap-3">
					<div className="p-3 bg-[#0E1726]/90 rounded-xl border border-slate-800 text-right">
						<p className="text-[10px] text-slate-400 font-bold uppercase">Received Amount</p>
						<p className="text-lg font-bold font-mono text-emerald-400">
							{formatCurrency(doc.received_amount || doc.paid_amount)}
						</p>
					</div>
				</div>
			</div>

			{/* G. SECTION 5: REFERENCES TABLE (`references` Child Table) */}
			<div className="bg-[#111A30]/90 backdrop-blur-md border border-white/[0.07] rounded-2xl overflow-hidden shadow-sm space-y-0">
				<button
					onClick={() => setIsReferencesOpen(!isReferencesOpen)}
					className="w-full p-4 flex items-center justify-between font-bold text-xs text-slate-300 bg-[#0E1726]/60 hover:bg-[#0E1726] transition border-b border-slate-800 cursor-pointer"
				>
					<div>
						<span className="font-bold text-sm block text-white">Payment References</span>
						<span className="text-[11px] font-normal text-slate-400">
							Invoices, Work Orders, and documents allocated against this payment
						</span>
					</div>
					<ChevronDown size={16} className={`transition-transform ${isReferencesOpen ? "rotate-180" : ""}`} />
				</button>

				{isReferencesOpen && (
					<div>
						<div className="overflow-x-auto">
							<table className="w-full text-left text-xs">
								<thead className="bg-[#0E1726] text-slate-400 uppercase font-semibold text-xs tracking-wider border-b border-slate-800">
									<tr>
										<th className="p-3.5 w-10">No.</th>
										<th className="p-3.5">Type</th>
										<th className="p-3.5">Name</th>
										<th className="p-3.5 text-right">Grand Total</th>
										<th className="p-3.5 text-right">Outstanding</th>
										<th className="p-3.5 text-right">Allocated Amount</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-800/60">
									{doc.references && doc.references.length > 0 ? (
										doc.references.map((ref: any, idx: number) => (
											<tr key={idx} className="border-b border-slate-800/60 hover:bg-cyan-500/5 transition">
												<td className="p-3.5 text-slate-400 font-semibold">{idx + 1}</td>
												<td className="p-3.5 font-semibold text-slate-200">{ref.reference_doctype}</td>
												<td className="p-3.5 font-mono font-bold text-cyan-400">
													{ref.reference_name?.startsWith("PINV-") && onSelectInvoice ? (
														<span
															onClick={() => onSelectInvoice(ref.reference_name)}
															className="hover:underline cursor-pointer flex items-center gap-1"
														>
															{ref.reference_name} <ExternalLink size={12} />
														</span>
													) : (
														<span>{ref.reference_name}</span>
													)}
												</td>
												<td className="p-3.5 text-right font-mono font-medium text-slate-200">{formatCurrency(ref.total_amount)}</td>
												<td className="p-3.5 text-right font-mono font-medium text-amber-400">
													{formatCurrency(ref.outstanding_amount)}
												</td>
												<td className="p-3.5 text-right font-mono font-bold text-emerald-400">
													{formatCurrency(ref.allocated_amount)}
												</td>
											</tr>
										))
									) : (
										<tr>
											<td colSpan={6} className="p-8 text-center text-slate-400">
												No reference documents allocated against this Payment Entry.
											</td>
										</tr>
									)}
								</tbody>
							</table>
						</div>

						{/* Reference Breakdown Bottom Strip */}
						<div className="p-4 bg-[#0E1726]/60 border-t border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
							<div>
								<span className="text-slate-400">Total Allocated Amount:</span>
								<p className="font-mono font-bold text-white text-sm mt-0.5">
									{formatCurrency(doc.total_allocated_amount || doc.paid_amount)}
								</p>
							</div>
							<div>
								<span className="text-slate-400">Unallocated Amount:</span>
								<p className="font-mono font-bold text-white text-sm mt-0.5">
									{formatCurrency(doc.unallocated_amount || 0)}
								</p>
							</div>
							<div>
								<span className="text-slate-400">Difference Amount:</span>
								<p className="font-mono font-bold text-white text-sm mt-0.5">
									{formatCurrency(doc.difference_amount || 0)}
								</p>
							</div>
						</div>
					</div>
				)}
			</div>

			{/* H. SECTION 6: DEDUCTIONS OR LOSS TABLE (`deductions` Child Table) */}
			<div className="bg-[#111A30]/90 backdrop-blur-md border border-white/[0.07] rounded-2xl overflow-hidden shadow-sm space-y-0">
				<button
					onClick={() => setIsDeductionsOpen(!isDeductionsOpen)}
					className="w-full p-4 flex items-center justify-between font-bold text-xs text-slate-300 bg-[#0E1726]/60 hover:bg-[#0E1726] transition border-b border-slate-800 cursor-pointer"
				>
					<div>
						<span className="font-bold text-sm block text-white">Deductions or Loss</span>
						<span className="text-[11px] font-normal text-slate-400">
							Retention, TDS, Labour Cess, and other contract deductions applied during disbursement
						</span>
					</div>
					<ChevronDown size={16} className={`transition-transform ${isDeductionsOpen ? "rotate-180" : ""}`} />
				</button>

				{isDeductionsOpen && (
					<div>
						<div className="overflow-x-auto">
							<table className="w-full text-left text-xs">
								<thead className="bg-[#0E1726] text-slate-400 uppercase font-semibold text-xs tracking-wider border-b border-slate-800">
									<tr>
										<th className="p-3.5 w-10">No.</th>
										<th className="p-3.5">Account</th>
										<th className="p-3.5">Cost Center</th>
										<th className="p-3.5 text-right">Amount (INR)</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-800/60">
									{doc.deductions && doc.deductions.length > 0 ? (
										doc.deductions.map((d: any, idx: number) => (
											<tr key={idx} className="border-b border-slate-800/60 hover:bg-cyan-500/5 transition">
												<td className="p-3.5 text-slate-400 font-semibold">{idx + 1}</td>
												<td className="p-3.5 font-semibold text-slate-200">{d.account}</td>
												<td className="p-3.5 text-slate-400">{d.cost_center || "-"}</td>
												<td className="p-3.5 text-right font-mono font-bold text-rose-400">
													-{formatCurrency(d.amount)}
												</td>
											</tr>
										))
									) : (
										<tr>
											<td colSpan={4} className="p-8 text-center text-slate-400">
												No deductions recorded on this Payment Entry.
											</td>
										</tr>
									)}
								</tbody>
							</table>
						</div>

						{totalDeductionsAmount > 0 && (
							<div className="p-4 bg-[#0E1726]/60 border-t border-slate-800 flex justify-between items-center text-xs">
								<span className="font-bold text-slate-200">Total Deductions:</span>
								<span className="font-mono font-bold text-rose-400 text-sm">
									-{formatCurrency(totalDeductionsAmount)}
								</span>
							</div>
						)}
					</div>
				)}
			</div>

			{/* I. SECTION 7: ACCOUNTING DIMENSIONS & REMARKS */}
			<div className="bg-[#111A30]/90 backdrop-blur-md border border-white/[0.07] rounded-2xl overflow-hidden shadow-sm space-y-0">
				<button
					onClick={() => setIsDimensionsOpen(!isDimensionsOpen)}
					className="w-full p-4 flex items-center justify-between font-bold text-xs text-slate-300 bg-[#0E1726]/60 hover:bg-[#0E1726] transition border-b border-slate-800 cursor-pointer"
				>
					<span className="font-bold text-sm text-white">Accounting Dimensions & Additional Info</span>
					<ChevronDown size={16} className={`transition-transform ${isDimensionsOpen ? "rotate-180" : ""}`} />
				</button>

				{isDimensionsOpen && (
					<div className="p-6 space-y-4 text-xs">
						<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
							<div>
								<span className="text-slate-400">Project:</span>
								<p className="font-bold text-white text-sm mt-0.5">
									{doc.project || "RISE"}
								</p>
							</div>
							<div>
								<span className="text-slate-400">Cost Center:</span>
								<p className="font-semibold text-slate-200 text-sm mt-0.5">
									{doc.cost_center || "Main - T"}
								</p>
							</div>
							<div>
								<span className="text-slate-400">Status:</span>
								<p className="font-bold text-white text-sm mt-0.5">
									{doc.status || "Submitted"}
								</p>
							</div>
						</div>

						{doc.remarks && (
							<div className="pt-2 border-t border-slate-800">
								<span className="text-slate-400 font-semibold">Remarks:</span>
								<div className="mt-1.5 p-3.5 bg-[#0E1726] rounded-xl border border-slate-800 text-slate-300 font-mono text-[11px] whitespace-pre-wrap">
									{doc.remarks}
								</div>
							</div>
						)}
					</div>
				)}
			</div>

			{/* 3. GENERAL LEDGER VIEWER MODAL */}
			{isLedgerOpen && (
				<div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
					<div className="bg-[#111A30] border border-slate-800 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden animate-fadeIn text-slate-200">
						{/* Modal Header */}
						<div className="p-5 border-b border-slate-800 flex justify-between items-center bg-[#0E1726]">
							<div className="flex items-center gap-3">
								<div className="w-9 h-9 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 flex items-center justify-center font-bold">
									<Coins size={18} />
								</div>
								<div>
									<h3 className="font-bold text-base text-white">
										General Ledger Entries
									</h3>
									<p className="text-xs text-slate-400">
										Voucher: <span className="font-mono font-bold text-cyan-400">{doc.name}</span>
									</p>
								</div>
							</div>

							<button
								onClick={() => setIsLedgerOpen(false)}
								className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition cursor-pointer"
							>
								<X size={18} />
							</button>
						</div>

						{/* Modal Body */}
						<div className="p-6 overflow-y-auto flex-1">
							{isLoadingGL ? (
								<div className="p-12 text-center text-slate-400">Loading General Ledger entries...</div>
							) : glEntries.length > 0 ? (
								<div className="overflow-x-auto">
									<table className="w-full text-left text-xs">
										<thead className="bg-[#0E1726] text-slate-400 uppercase font-semibold text-xs tracking-wider border-b border-slate-800">
											<tr>
												<th className="p-3.5">Posting Date</th>
												<th className="p-3.5">Account</th>
												<th className="p-3.5 text-right">Debit (INR)</th>
												<th className="p-3.5 text-right">Credit (INR)</th>
												<th className="p-3.5">Against Account</th>
												<th className="p-3.5">Voucher Type</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-slate-800/60">
											{glEntries.map((gl: any, idx: number) => (
												<tr key={idx} className="border-b border-slate-800/60 hover:bg-cyan-500/5 transition">
													<td className="p-3.5 text-slate-400">{gl.posting_date}</td>
													<td className="p-3.5 font-semibold text-white">{gl.account}</td>
													<td className="p-3.5 text-right font-mono font-bold text-white">
														{gl.debit > 0 ? formatCurrency(gl.debit) : "-"}
													</td>
													<td className="p-3.5 text-right font-mono font-bold text-emerald-400">
														{gl.credit > 0 ? formatCurrency(gl.credit) : "-"}
													</td>
													<td className="p-3.5 text-slate-400">{gl.against || "-"}</td>
													<td className="p-3.5 font-mono text-slate-400">{gl.voucher_type || "Payment Entry"}</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							) : (
								<div className="p-12 text-center text-slate-400">
									No General Ledger entries recorded for this Payment Entry.
								</div>
							)}
						</div>

						{/* Modal Footer */}
						<div className="p-4 bg-[#0E1726] border-t border-slate-800 flex justify-end">
							<button
								onClick={() => setIsLedgerOpen(false)}
								className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition cursor-pointer"
							>
								Close
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
