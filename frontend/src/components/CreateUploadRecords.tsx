import React, { useState } from "react";
import {
	UploadCloud,
	Download,
	Plus,
	FileSpreadsheet,
	CheckCircle2,
	FolderPlus,
	AlertCircle,
	AlertTriangle,
	ExternalLink,
	Receipt,
	RefreshCw,
	FileWarning,
	Lightbulb,
} from "lucide-react";

import { callFrappeMethod, parseFrappeError, getFrappeCSRFToken } from "../utils/frappeErrors";

const exportFieldMaps: Record<string, Record<string, string[]>> = {
	"Item": {
		"Item": [
			"item_code",
			"item_name",
			"item_group",
			"gst_hsn_code",
			"stock_uom",
			"is_stock_item",
			"is_fixed_asset",
		],
	},
	"RA Bill": {
		"RA Bill": [
			"naming_series",
			"project",
			"boq",
			"bill_type",
			"customer",
			"supplier",
			"company",
			"posting_date",
			"ra_bill_no",
			"is_final_bill",
			"billing_method",
			"apply_gst",
			"gst_percentage",
		],
		items: [
			"item_code",
			"description",
			"uom",
			"rate",
			"boq_qty",
			"previous_qty",
			"cumulative_qty",
		],
		additions: [
			"addition_type",
			"description",
			"method",
			"rate",
			"amount",
		],
		deductions: [
			"deduction_type",
			"description",
			"method",
			"rate",
			"amount",
		],
	},
	"RAB Work Order": {
		"RAB Work Order": [
			"naming_series",
			"project",
			"boq_type",
			"customer",
			"supplier",
			"company",
			"currency",
			"contract_date",
			"billing_method",
			"defect_liability_period_days",
			"contract_value",
			"deviation_tolerance_percentage",
			"mobilization_advance_amount",
			"apply_gst",
			"gst_percentage",
		],
		items: [
			"item_code",
			"description",
			"uom",
			"qty",
			"boq_qty",
			"rate",
			"amount",
		],
		additions: [
			"addition_type",
			"description",
			"method",
			"rate",
			"amount",
		],
		deductions: [
			"deduction_type",
			"description",
			"method",
			"rate",
			"amount",
		],
		advances: [
			"advance_type",
			"description",
			"amount",
		],
	},
	"Purchase Invoice": {
		"Purchase Invoice": [
			"supplier",
			"company",
			"posting_date",
			"due_date",
			"project",
			"ra_bill",
			"bill_no",
			"bill_date",
			"currency",
		],
		items: [
			"item_code",
			"description",
			"qty",
			"rate",
			"uom",
			"expense_account",
		],
	},
	"Payment Entry": {
		"Payment Entry": [
			"payment_type",
			"party_type",
			"party",
			"company",
			"posting_date",
			"paid_amount",
			"received_amount",
			"mode_of_payment",
			"paid_from",
			"paid_to",
			"reference_no",
			"reference_date",
			"work_order",
			"remarks",
		],
	},
};

interface ImportStatusResult {
	status: "Pending" | "In Progress" | "Success" | "Partial Success" | "Error" | "Timed Out";
	success?: number;
	failed?: number;
	total_records?: number;
}

interface ImportLogItem {
	success: 0 | 1;
	docname?: string | null;
	row_indexes?: string;
	messages?: string;
	exception?: string;
}

interface CreateUploadRecordsProps {
	onOpenCreateWO: () => void;
	onOpenCreateRABill: () => void;
}

function parseErrorMessage(messagesStr?: string, exceptionStr?: string): string {
	if (messagesStr) {
		try {
			const parsed = JSON.parse(messagesStr);
			if (Array.isArray(parsed) && parsed.length > 0) {
				return parsed
					.map((m: any) => {
						if (typeof m === "string") return m;
						return m.message || m.title || JSON.stringify(m);
					})
					.join("; ");
			}
			if (typeof parsed === "string") return parsed;
		} catch (_) {
			return messagesStr;
		}
	}
	if (exceptionStr) {
		const lines = exceptionStr.trim().split("\n");
		const lastLine = lines[lines.length - 1];
		return lastLine || "Validation Error";
	}
	return "Validation or link constraint failure";
}

function parseRowIndex(rowIndexesStr?: string): string {
	if (!rowIndexesStr) return "-";
	try {
		const parsed = JSON.parse(rowIndexesStr);
		if (Array.isArray(parsed)) {
			return parsed.join(", ");
		}
		return String(parsed);
	} catch (_) {
		return rowIndexesStr;
	}
}

export function CreateUploadRecords({ onOpenCreateWO, onOpenCreateRABill }: CreateUploadRecordsProps) {
	const [selectedDocType, setSelectedDocType] = useState<string>("RA Bill");
	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	const [templateFormat, setTemplateFormat] = useState<"Excel" | "CSV">("Excel");

	// Processing & Progress States
	const [isProcessing, setIsProcessing] = useState(false);
	const [processStage, setProcessStage] = useState<string>("");

	// Result States
	const [dataImportName, setDataImportName] = useState<string | null>(null);
	const [importStatus, setImportStatus] = useState<ImportStatusResult | null>(null);
	const [importLogs, setImportLogs] = useState<ImportLogItem[]>([]);
	const [importError, setImportError] = useState<string | null>(null);

	const docTypes = [
		{ id: "Item", label: "Item Master" },
		{ id: "RA Bill", label: "RA Bill" },
		{ id: "RAB Work Order", label: "RAB Work Order" },
		{ id: "Purchase Invoice", label: "Purchase Invoice" },
		{ id: "Payment Entry", label: "Payment Entry" },
	];

	const getDeskDocUrl = (doctype: string, docname?: string | null) => {
		const slug = doctype.toLowerCase().replace(/ /g, "-");
		if (!docname) return `/app/${slug}`;
		return `/app/${slug}/${encodeURIComponent(docname)}`;
	};

	// 1. Download official Frappe core template using download_template
	const handleDownloadTemplate = () => {
		const fields = exportFieldMaps[selectedDocType] || { [selectedDocType]: [] };
		const form = document.createElement("form");
		form.method = "POST";
		form.action = "/api/method/frappe.core.doctype.data_import.data_import.download_template";
		form.style.display = "none";

		const params: Record<string, string> = {
			doctype: selectedDocType,
			file_type: templateFormat,
			export_records: "blank_template",
			export_fields: JSON.stringify(fields),
			csrf_token: getFrappeCSRFToken(),
		};

		for (const key in params) {
			const input = document.createElement("textarea");
			input.name = key;
			input.value = params[key];
			form.appendChild(input);
		}

		document.body.appendChild(form);
		form.submit();
		document.body.removeChild(form);
	};

	// Download errored template for failed rows
	const handleDownloadErroredTemplate = () => {
		if (!dataImportName) return;
		const form = document.createElement("form");
		form.method = "POST";
		form.action = "/api/method/frappe.core.doctype.data_import.data_import.download_errored_template";
		form.style.display = "none";

		const params: Record<string, string> = {
			data_import_name: dataImportName,
			csrf_token: getFrappeCSRFToken(),
		};

		for (const key in params) {
			const input = document.createElement("textarea");
			input.name = key;
			input.value = params[key];
			form.appendChild(input);
		}

		document.body.appendChild(form);
		form.submit();
		document.body.removeChild(form);
	};

	const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		if (e.dataTransfer.files && e.dataTransfer.files[0]) {
			setSelectedFile(e.dataTransfer.files[0]);
			resetResultState();
		}
	};

	const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
		if (e.target.files && e.target.files[0]) {
			setSelectedFile(e.target.files[0]);
			resetResultState();
		}
	};

	const resetResultState = () => {
		setDataImportName(null);
		setImportStatus(null);
		setImportLogs([]);
		setImportError(null);
	};

	// 2. Real Upload & Data Import Pipeline using Frappe Core engine
	const handleUploadAndProcess = async () => {
		if (!selectedFile) return;
		setIsProcessing(true);
		resetResultState();

		try {
			// Stage 1: Upload file to Frappe /api/method/upload_file
			setProcessStage("Uploading file to server...");
			const formData = new FormData();
			formData.append("file", selectedFile);
			formData.append("is_private", "1");
			formData.append("folder", "Home");

			const uploadRes = await fetch("/api/method/upload_file", {
				method: "POST",
				headers: {
					"X-Frappe-CSRF-Token": getFrappeCSRFToken(),
				},
				body: formData,
			});

			if (!uploadRes.ok) {
				const errText = await uploadRes.text();
				throw new Error(`File upload failed: ${errText}`);
			}

			const uploadJson = await uploadRes.json();
			const fileUrl = uploadJson.message?.file_url;
			if (!fileUrl) {
				throw new Error(uploadJson.message || "No file URL returned from upload");
			}

			// Stage 2: Create real Data Import document in the backend
			setProcessStage("Creating Data Import document...");
			const dataImportDoc = await callFrappeMethod("frappe.client.insert", {
				doc: {
					doctype: "Data Import",
					reference_doctype: selectedDocType,
					import_type: "Insert New Records",
					import_file: fileUrl,
					submit_after_import: 0,
				},
			});

			const diName = dataImportDoc.name || dataImportDoc;
			setDataImportName(diName);

			// Stage 3: Start the import via core form_start_import
			setProcessStage("Running Data Import engine...");
			await callFrappeMethod("frappe.core.doctype.data_import.data_import.form_start_import", {
				data_import: diName,
			});

			// Stage 4: Poll status via get_import_status
			setProcessStage("Importing records and validating constraints...");
			let finalStatus: ImportStatusResult | null = null;
			for (let i = 0; i < 30; i++) {
				await new Promise((resolve) => setTimeout(resolve, 1500));
				try {
					const statusRes = await callFrappeMethod(
						"frappe.core.doctype.data_import.data_import.get_import_status",
						{ data_import_name: diName }
					);
					finalStatus = statusRes;
					setImportStatus(statusRes);

					if (
						statusRes &&
						statusRes.status !== "Pending" &&
						statusRes.status !== "In Progress"
					) {
						break;
					}
				} catch (pollErr) {
					console.warn("Poll status check:", pollErr);
				}
			}

			// Stage 5: Fetch detailed per-row logs
			setProcessStage("Fetching validation logs...");
			try {
				const logsRes = await callFrappeMethod(
					"frappe.core.doctype.data_import.data_import.get_import_logs",
					{ data_import: diName }
				);
				setImportLogs(Array.isArray(logsRes) ? logsRes : []);
			} catch (logErr) {
				console.warn("Fetch logs error:", logErr);
			}

			setProcessStage("");
		} catch (err: any) {
			console.error("Data Import execution error:", err);
			const parsed = parseFrappeError(err, "Data Import Error");
			setImportError(parsed.message);
			setProcessStage("");
		} finally {
			setIsProcessing(false);
		}
	};

	const failedLogs = importLogs.filter((l) => !l.success);
	const successfulLogs = importLogs.filter((l) => !!l.success);

	return (
		<div className="space-y-6 text-slate-800 dark:text-slate-100 transition-colors duration-200">
			{/* Page Header */}
			<div className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] rounded-2xl p-6 shadow-sm flex flex-wrap items-center justify-between gap-4">
				<div className="flex items-center gap-4">
					<div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-[#7367f0]/15 text-indigo-600 dark:text-[#7367f0] flex items-center justify-center border border-indigo-200 dark:border-[#7367f0]/30 shrink-0">
						<FolderPlus size={24} />
					</div>
					<div>
						<h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
							Create / Upload Records
						</h2>
						<p className="text-xs text-slate-500 dark:text-[#8f93a7] mt-0.5">
							Bulk import transactions via Frappe core Data Import engine or create individual records manually.
						</p>
					</div>
				</div>
			</div>

			{/* 2-Column Main Layout */}
			<div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
				{/* LEFT COLUMN (68% Width): Bulk Import Zone */}
				<div className="lg:col-span-8 bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] rounded-2xl p-6 shadow-sm space-y-6">
					<div className="border-b border-slate-200 dark:border-[#32344d] pb-4 flex flex-wrap items-center justify-between gap-4">
						<div>
							<h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
								Frappe Data Import Engine
							</h3>
							<p className="text-xs text-slate-500 dark:text-[#8f93a7]">
								Official template generation, multi-row child table import, and strict link validation
							</p>
						</div>

						{/* Template Download Controls */}
						<div className="flex items-center gap-2">
							<select
								value={templateFormat}
								onChange={(e) => setTemplateFormat(e.target.value as any)}
								className="p-2 bg-slate-100 dark:bg-[#1e1e2d] border border-slate-200 dark:border-[#32344d] rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none"
								title="Select template format"
							>
								<option value="Excel">Excel (.xlsx)</option>
								<option value="CSV">CSV (.csv)</option>
							</select>

							<button
								onClick={handleDownloadTemplate}
								className="px-4 py-2 bg-indigo-50 dark:bg-[#7367f0]/15 hover:bg-indigo-100 dark:hover:bg-[#7367f0]/25 text-indigo-600 dark:text-[#7367f0] border border-indigo-200 dark:border-[#7367f0]/30 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer"
								title={`Download official ${selectedDocType} template`}
							>
								<Download size={15} />
								<span>Download Official Template</span>
							</button>
						</div>
					</div>

					{/* Recommended Workflow Guidance */}
					<div className="p-3.5 bg-indigo-50/70 dark:bg-[#7367f0]/10 border border-indigo-200/80 dark:border-[#7367f0]/30 rounded-xl flex items-start gap-3">
						<div className="p-1.5 bg-indigo-600/10 dark:bg-[#7367f0]/20 rounded-lg text-indigo-600 dark:text-[#7367f0] shrink-0 mt-0.5">
							<Lightbulb size={16} />
						</div>
						<div className="text-xs">
							<span className="font-bold text-indigo-900 dark:text-indigo-200">Recommended Sequence: </span>
							<span className="text-slate-600 dark:text-slate-300">
								Import your <strong>Item Master</strong> first if these items don't already exist in the system, before importing Work Order or RA Bill records that reference them.
							</span>
						</div>
					</div>

					{/* 1. Document Type Selector */}
					<div className="space-y-3">
						<label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#8f93a7]">
							1. Target Document Type
						</label>
						<div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
							{docTypes.map((dt) => (
								<button
									key={dt.id}
									onClick={() => {
										setSelectedDocType(dt.id);
										resetResultState();
									}}
									className={`p-3 rounded-xl border text-xs font-semibold text-center transition cursor-pointer ${
										selectedDocType === dt.id
											? "bg-indigo-50 dark:bg-[#7367f0]/15 text-indigo-600 dark:text-[#7367f0] border-indigo-300 dark:border-[#7367f0] shadow-xs font-bold"
											: "bg-slate-50 dark:bg-[#1e1e2d] text-slate-600 dark:text-[#8f93a7] border-slate-200 dark:border-[#2d2d3f] hover:border-slate-300"
									}`}
								>
									{dt.label}
								</button>
							))}
						</div>
					</div>

					{/* 2. File Dropzone Area */}
					<div className="space-y-3">
						<label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#8f93a7]">
							2. Upload Populated Spreadsheet
						</label>
						<div
							onDragOver={(e) => e.preventDefault()}
							onDrop={handleFileDrop}
							className="border-2 border-dashed border-indigo-300 dark:border-[#7367f0]/50 hover:border-indigo-600 dark:hover:border-[#7367f0] bg-slate-50 dark:bg-[#1e1e2d]/60 rounded-2xl p-8 text-center transition cursor-pointer flex flex-col items-center justify-center space-y-3 group"
						>
							<div className="w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-[#7367f0]/15 text-indigo-600 dark:text-[#7367f0] flex items-center justify-center group-hover:scale-105 transition">
								<UploadCloud size={28} />
							</div>

							<div>
								<p className="text-sm font-bold text-slate-800 dark:text-slate-200">
									{selectedFile ? selectedFile.name : "Drag & drop populated spreadsheet here"}
								</p>
								<p className="text-xs text-slate-400 dark:text-[#8f93a7] mt-0.5">
									Excel (.xlsx, .xls) or CSV (.csv) generated from the official {selectedDocType} template
								</p>
							</div>

							<label className="mt-2 inline-block px-5 py-2 bg-indigo-600 dark:bg-[#7367f0] hover:bg-indigo-700 dark:hover:bg-[#685dd8] text-white font-semibold text-xs rounded-xl shadow-md cursor-pointer transition">
								<span>Browse File</span>
								<input
									type="file"
									accept=".csv, .xlsx, .xls"
									onChange={handleFileSelect}
									className="hidden"
								/>
							</label>
						</div>
					</div>

					{/* File Preview & Upload Action */}
					{selectedFile && (
						<div className="p-5 bg-slate-50 dark:bg-[#1e1e2d] rounded-2xl border border-slate-200 dark:border-[#2d2d3f] space-y-4">
							<div className="flex flex-wrap items-center justify-between gap-3">
								<div className="flex items-center gap-3">
									<div className="p-2.5 bg-emerald-500/15 text-emerald-600 rounded-xl">
										<FileSpreadsheet size={22} />
									</div>
									<div>
										<p className="text-xs font-bold text-slate-900 dark:text-slate-100">
											{selectedFile.name}
										</p>
										<p className="text-[11px] text-slate-400 dark:text-[#8f93a7]">
											{(selectedFile.size / 1024).toFixed(1)} KB | Target: {selectedDocType}
										</p>
									</div>
								</div>

								<button
									onClick={handleUploadAndProcess}
									disabled={isProcessing}
									className="px-5 py-2.5 bg-emerald-600 dark:bg-[#28c76f] hover:bg-emerald-700 dark:hover:bg-[#24b263] text-white text-xs font-bold rounded-xl shadow-md transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
								>
									{isProcessing && <RefreshCw size={14} className="animate-spin" />}
									<span>{isProcessing ? "Processing Import..." : "Start Data Import"}</span>
								</button>
							</div>

							{/* Active Processing Stage */}
							{isProcessing && processStage && (
								<div className="flex items-center gap-2 text-xs font-semibold text-indigo-600 dark:text-[#7367f0] pt-2 border-t border-slate-200 dark:border-[#2d2d3f]">
									<RefreshCw size={14} className="animate-spin" />
									<span>{processStage}</span>
								</div>
							)}
						</div>
					)}

					{/* General Error Banner */}
					{importError && (
						<div className="p-4 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-2xl text-xs text-rose-700 dark:text-rose-400 flex items-start gap-3">
							<AlertCircle size={18} className="shrink-0 mt-0.5" />
							<div>
								<p className="font-bold">Import Error</p>
								<p className="mt-0.5">{importError}</p>
							</div>
						</div>
					)}

					{/* Data Import Results Panel */}
					{importStatus && (
						<div className="p-5 bg-slate-50 dark:bg-[#1e1e2d] rounded-2xl border border-slate-200 dark:border-[#2d2d3f] space-y-4">
							<div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-[#2d2d3f] pb-3">
								<div className="flex items-center gap-2.5">
									<h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">
										Import Results
									</h4>
									<span
										className={`px-3 py-0.5 rounded-full text-xs font-bold border ${
											importStatus.status === "Success"
												? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30"
												: importStatus.status === "Partial Success"
												? "bg-amber-500/15 text-amber-600 border-amber-500/30"
												: "bg-rose-500/15 text-rose-600 border-rose-500/30"
										}`}
									>
										{importStatus.status}
									</span>
								</div>

								{dataImportName && (
									<a
										href={`/app/data-import/${encodeURIComponent(dataImportName)}`}
										target="_blank"
										rel="noreferrer"
										className="text-xs text-indigo-600 dark:text-[#7367f0] hover:underline flex items-center gap-1 font-semibold"
									>
										<span>Desk Document: {dataImportName}</span>
										<ExternalLink size={12} />
									</a>
								)}
							</div>

							{/* Summary Counters */}
							<div className="grid grid-cols-3 gap-3">
								<div className="p-3 bg-white dark:bg-[#232333] rounded-xl border border-slate-200 dark:border-[#32344d]">
									<p className="text-[10px] font-bold uppercase text-slate-400">Total Records</p>
									<p className="text-lg font-extrabold text-slate-800 dark:text-slate-100 mt-0.5">
										{importStatus.total_records ?? (successfulLogs.length + failedLogs.length)}
									</p>
								</div>
								<div className="p-3 bg-white dark:bg-[#232333] rounded-xl border border-slate-200 dark:border-[#32344d]">
									<p className="text-[10px] font-bold uppercase text-emerald-500">Successful</p>
									<p className="text-lg font-extrabold text-emerald-600 dark:text-[#28c76f] mt-0.5">
										{importStatus.success ?? successfulLogs.length}
									</p>
								</div>
								<div className="p-3 bg-white dark:bg-[#232333] rounded-xl border border-slate-200 dark:border-[#32344d]">
									<p className="text-[10px] font-bold uppercase text-rose-500">Failed</p>
									<p className="text-lg font-extrabold text-rose-600 dark:text-[#ea5455] mt-0.5">
										{importStatus.failed ?? failedLogs.length}
									</p>
								</div>
							</div>

							{/* Failed Rows Section & Errored Template Download */}
							{failedLogs.length > 0 && (
								<div className="space-y-3 pt-2">
									<div className="flex items-center justify-between">
										<div className="flex items-center gap-1.5 text-xs font-bold text-rose-600 dark:text-[#ea5455]">
											<AlertTriangle size={15} />
											<span>Failed Rows & Validation Detail ({failedLogs.length})</span>
										</div>

										<button
											onClick={handleDownloadErroredTemplate}
											className="px-3 py-1 bg-rose-50 dark:bg-rose-500/15 hover:bg-rose-100 dark:hover:bg-rose-500/25 text-rose-600 dark:text-[#ea5455] border border-rose-200 dark:border-rose-500/30 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
											title="Download spreadsheet with errored rows only"
										>
											<FileWarning size={13} />
											<span>Download Errored Template</span>
										</button>
									</div>

									<div className="overflow-x-auto rounded-xl border border-rose-200 dark:border-rose-500/30">
										<table className="w-full text-left text-xs bg-white dark:bg-[#232333]">
											<thead className="bg-rose-50/50 dark:bg-rose-500/10 text-slate-700 dark:text-slate-300 font-bold border-b border-rose-200 dark:border-rose-500/30">
												<tr>
													<th className="p-2.5 w-20">Row(s)</th>
													<th className="p-2.5">Validation Reason / Error</th>
												</tr>
											</thead>
											<tbody className="divide-y divide-slate-200 dark:divide-[#32344d]">
												{failedLogs.map((log, idx) => (
													<tr key={idx} className="hover:bg-rose-50/30 dark:hover:bg-rose-500/5">
														<td className="p-2.5 font-mono font-bold text-rose-600 dark:text-[#ea5455]">
															Row {parseRowIndex(log.row_indexes)}
														</td>
														<td className="p-2.5 text-slate-700 dark:text-slate-300">
															{parseErrorMessage(log.messages, log.exception)}
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								</div>
							)}

							{/* Successful Records Section with Desk Submit Action */}
							{successfulLogs.length > 0 && (
								<div className="space-y-3 pt-2">
									<div className="p-3.5 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-xl text-xs text-emerald-700 dark:text-[#28c76f] flex items-center justify-between">
										<div className="flex items-center gap-2">
											<CheckCircle2 size={16} />
											<span className="font-semibold">
												{successfulLogs.length} record(s) imported as Draft into {selectedDocType}. Review and submit in Frappe Desk below.
											</span>
										</div>
									</div>

									<div className="overflow-x-auto rounded-xl border border-emerald-200 dark:border-emerald-500/30">
										<table className="w-full text-left text-xs bg-white dark:bg-[#232333]">
											<thead className="bg-emerald-50/50 dark:bg-emerald-500/10 text-slate-700 dark:text-slate-300 font-bold border-b border-emerald-200 dark:border-emerald-500/30">
												<tr>
													<th className="p-2.5">Imported Document</th>
													<th className="p-2.5 text-center w-52">Desk Action</th>
												</tr>
											</thead>
											<tbody className="divide-y divide-slate-200 dark:divide-[#32344d]">
												{successfulLogs.map((log, idx) => (
													<tr key={idx} className="hover:bg-emerald-50/30 dark:hover:bg-emerald-500/5">
														<td className="p-2.5 font-mono font-bold text-slate-900 dark:text-slate-100">
															{log.docname || `Record #${idx + 1}`}
														</td>
														<td className="p-2.5 text-center">
															<a
																href={getDeskDocUrl(selectedDocType, log.docname)}
																target="_blank"
																rel="noreferrer"
																className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-50 dark:bg-[#7367f0]/15 hover:bg-indigo-100 dark:hover:bg-[#7367f0]/25 text-indigo-600 dark:text-[#7367f0] border border-indigo-200 dark:border-[#7367f0]/30 rounded-lg text-xs font-bold transition"
															>
																<span>Review &amp; Submit in Desk</span>
																<ExternalLink size={12} />
															</a>
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								</div>
							)}
						</div>
					)}
				</div>

				{/* RIGHT COLUMN (32% Width): Direct Manual Creation Panel */}
				<div className="lg:col-span-4 space-y-6">
					<div className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] rounded-2xl p-6 shadow-sm space-y-6">
						<div className="border-b border-slate-200 dark:border-[#32344d] pb-4">
							<h3 className="font-bold text-base text-slate-900 dark:text-slate-100">Direct Record Creation</h3>
							<p className="text-xs text-slate-500 dark:text-[#8f93a7] mt-0.5">Create individual records manually</p>
						</div>

						{/* Top Button: + Add New RAB Work Order */}
						<div className="space-y-2">
							<button
								onClick={onOpenCreateWO}
								className="w-full py-3.5 px-4 bg-indigo-600 dark:bg-[#7367f0] hover:bg-indigo-700 dark:hover:bg-[#685dd8] text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-md transition cursor-pointer"
							>
								<Plus size={16} />
								<span>+ Add New RAB Work Order</span>
							</button>
							<p className="text-[11px] text-slate-500 dark:text-[#8f93a7] px-1 text-center">
								Create a new contract, schedule of items, and billing terms.
							</p>
						</div>

						<div className="h-[1px] bg-slate-200 dark:bg-[#2d2d3f]"></div>

						{/* Bottom Button: + Add New RA Bill */}
						<div className="space-y-2">
							<button
								onClick={onOpenCreateRABill}
								className="w-full py-3.5 px-4 bg-slate-100 dark:bg-[#282a42] hover:bg-slate-200 dark:hover:bg-[#32344d] border border-indigo-200 dark:border-[#7367f0]/50 text-indigo-700 dark:text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition cursor-pointer"
							>
								<Receipt size={16} className="text-indigo-600 dark:text-[#7367f0]" />
								<span>+ Add New RA Bill</span>
							</button>
							<p className="text-[11px] text-slate-500 dark:text-[#8f93a7] px-1 text-center">
								Generate an RA Bill against an active Work Order.
							</p>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
