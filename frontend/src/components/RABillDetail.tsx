import React, { useState, useEffect, useMemo, useRef } from "react";
import { useFrappeGetDoc, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import * as XLSX from "xlsx";
import { RowEditorModal } from "./RowEditorModal";
import { ItemLinkDropdown } from "./ItemLinkDropdown";
import { DeskMessageModal } from "./DeskMessageModal";
import { parseFrappeError, callFrappeMethod } from "../utils/frappeErrors";
import {
	ArrowLeft,
	Printer,
	Plus,
	Save,
	CheckCircle2,
	Trash2,
	Edit3,
	Receipt,
	Download,
	Upload,
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

export const getAdvanceRecoveryDeductionType = (advanceType: string) => {
	if (advanceType === "Mobilization Advance") return "Mobilization Recovery";
	if (advanceType === "Ad Hoc Advance") return "Advance Recovery";
	return "Other";
};

export const getAdvanceRecoveryDescription = (adv: any) => {
	if (adv.advance_type === "Mobilization Advance") return "Mobilization Advance";
	if (adv.advance_type === "Ad Hoc Advance") return "Ad Hoc Advance";
	return adv.description ? `Other - ${adv.description}` : "Other Advance";
};

export const isAdvanceRecoveryType = (deductionType: string, description?: string) => {
	if (!deductionType) return false;
	const dt = deductionType.trim();
	const desc = (description || "").trim();
	if (
		dt === "Mobilization Recovery" ||
		dt === "Mobilization Advance Recovery" ||
		dt === "Mobilization Advance" ||
		dt === "Advance Recovery" ||
		dt === "Ad Hoc Advance Recovery" ||
		dt === "Ad Hoc Advance" ||
		dt.startsWith("Other -")
	) {
		return true;
	}
	if (dt === "Other" && (desc.startsWith("Other -") || desc.toLowerCase().includes("advance"))) {
		return true;
	}
	return false;
};

interface RABillDetailProps {
	billId: string;
	onBack: () => void;
	onCreateInvoiceSuccess?: (invoiceId: string) => void;
	onSelectBill?: (billId: string) => void;
}

export function RABillDetail({ billId, onBack, onCreateInvoiceSuccess, onSelectBill }: RABillDetailProps) {
	const { data: bill, isLoading, mutate } = useFrappeGetDoc("RA Bill", billId);
	const { updateDoc, loading: isSaving } = useFrappeUpdateDoc();
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [feedbackModal, setFeedbackModal] = useState<{
		title: string;
		message: string;
		indicator?: "red" | "orange" | "blue" | "green" | string;
	} | null>(null);

	// Fetch parent Work Order once bill is available
	const woName = bill?.boq || bill?.work_order || "";
	const { data: workOrder } = useFrappeGetDoc(
		"RAB Work Order",
		woName || undefined,
	);

	// Fetch all non-cancelled RA Bills for the same Work Order (sibling bills)
	const { data: siblingBills } = useFrappeGetDocList("RA Bill", {
		fields: ["name", "ra_bill_no", "posting_date", "gross_work_value", "net_payable", "docstatus", "mobilization_recovery_amount", "workflow_state"],
		filters: [
			["boq", "=", woName || "__placeholder__"],
			["docstatus", "!=", 2],
		],
		orderBy: { field: "ra_bill_no", order: "asc" },
		limit: 0,
	});

	// File input ref for CSV upload
	const itemsFileInputRef = useRef<HTMLInputElement>(null);

	// Editable Form States
	const [postingDate, setPostingDate] = useState("");
	const [raBillNo, setRaBillNo] = useState<number | "">(1);
	const [isFinalBill, setIsFinalBill] = useState(false);
	const [billingMethod, setBillingMethod] = useState("Item Rate (Measured)");
	const [applyGst, setApplyGst] = useState(true);
	const [gstPercentage, setGstPercentage] = useState(18);

	const [items, setItems] = useState<any[]>([]);
	const [additions, setAdditions] = useState<any[]>([]);
	const [deductions, setDeductions] = useState<any[]>([]);

	const [editingRowIndex, setEditingRowIndex] = useState<number | null>(null);

	// Workflow state & transitions
	const [workflowData, setWorkflowData] = useState<{
		has_workflow: boolean;
		workflow_state: string | null;
		docstatus: number;
		transitions: Array<{ action: string; next_state: string; allowed: string }>;
	} | null>(null);
	const [isApplyingWorkflow, setIsApplyingWorkflow] = useState(false);
	const [isCreatingInvoice, setIsCreatingInvoice] = useState(false);

	// Collapsible states
	const [isConnectionsOpen, setIsConnectionsOpen] = useState(true);
	const [isPartyOpen, setIsPartyOpen] = useState(true);
	const [isAdditionsOpen, setIsAdditionsOpen] = useState(true);
	const [isDeductionsOpen, setIsDeductionsOpen] = useState(true);

	const lastLoadedDocRef = useRef<{ name: string; modified: string } | null>(null);

	const fetchWorkflowDetails = async () => {
		try {
			const wf = await callFrappeMethod("ra_bill.api.get_workflow_details", { doctype: "RA Bill", name: billId });
			setWorkflowData(wf);
		} catch (err) {
			console.error("Failed to fetch workflow details:", err);
		}
	};

	useEffect(() => {
		if (bill) {
			const isDocChanged =
				!lastLoadedDocRef.current ||
				lastLoadedDocRef.current.name !== bill.name ||
				lastLoadedDocRef.current.modified !== bill.modified;

			if (isDocChanged) {
				lastLoadedDocRef.current = { name: bill.name, modified: bill.modified };
				fetchWorkflowDetails();
				setPostingDate(bill.posting_date || new Date().toISOString().split("T")[0]);
				setRaBillNo(bill.ra_bill_no || 1);
				setIsFinalBill(!!bill.is_final_bill);
				setBillingMethod(bill.billing_method || "Item Rate (Measured)");
				setApplyGst(bill.apply_gst !== 0);
				setGstPercentage(bill.gst_percentage || 18);

				// Map from server field names to local state.
				// Previous Qty: read-only from server
				// This Bill Qty: the only field the user edits
				// Cumulative Qty: previous_qty + this_bill_qty
				const mappedItems = (bill.items || []).map((it: any) => {
					const rate = Number(it.rate || 0);
					const prevQty = Number(it.previous_qty || 0);
					const cumulativeQty = Number(it.cumulative_qty || 0);
					const thisBillQty = Number(it.current_qty ?? (cumulativeQty - prevQty));
					return {
						...it,
						item_code: it.item_code || "",
						description: it.description || "",
						uom: it.uom || "Nos",
						rate,
						boq_qty: Number(it.boq_qty || 0),
						previous_qty: prevQty,
						this_bill_qty: thisBillQty,
						cumulative_qty: prevQty + thisBillQty,
						current_qty: thisBillQty,
					};
				});
				setItems(mappedItems);
				setAdditions(bill.additions || []);
			}

			let initialDeductions = [...(bill.deductions || [])];
			const woAdvances: any[] = (workOrder?.advances && workOrder.advances.length > 0)
				? workOrder.advances
				: (workOrder?.mobilization_advance_amount ? [{
					advance_type: "Mobilization Advance",
					description: "",
					amount: Number(workOrder.mobilization_advance_amount),
				}] : []);

			if (isDocChanged || (deductions.length === 0 && woAdvances.length > 0)) {
				if (woAdvances.length > 0) {
					const nonAdvDeductions = initialDeductions.filter((d: any) => !isAdvanceRecoveryType(d.deduction_type, d.description));
					const advDeductions = initialDeductions.filter((d: any) => isAdvanceRecoveryType(d.deduction_type, d.description));

					const mappedAdvDeductions = woAdvances.map((adv: any) => {
						const dt = getAdvanceRecoveryDeductionType(adv.advance_type);
						const desc = getAdvanceRecoveryDescription(adv);
						const existing = advDeductions.find((d: any) => {
							if (adv.advance_type === "Mobilization Advance") {
								return d.deduction_type === "Mobilization Recovery" || d.deduction_type === "Mobilization Advance Recovery" || d.description === desc;
							}
							if (adv.advance_type === "Ad Hoc Advance") {
								return d.deduction_type === "Advance Recovery" || d.deduction_type === "Ad Hoc Advance Recovery" || d.description === desc;
							}
							return d.description === desc || (d.deduction_type === "Other" && d.description?.includes(adv.description || ""));
						});
						if (existing) {
							return {
								...existing,
								deduction_type: dt,
								description: existing.description || desc,
								advance_amount: Number(adv.amount || 0),
							};
						}
						return {
							deduction_type: dt,
							description: desc,
							method: "Percentage",
							calculation_method: "Percentage",
							rate: 20,
							amount: 0,
							advance_amount: Number(adv.amount || 0),
						};
					});

					setDeductions([...nonAdvDeductions, ...mappedAdvDeductions]);
				} else if (isDocChanged) {
					setDeductions(initialDeductions);
				}
			}
		}
	}, [bill, workOrder]);

	// Dynamic Live Financial Recalculations
	const grossWorkValue = useMemo(() => {
		// this_bill_qty is "this bill qty"; rate gives this bill amount
		return items.reduce((acc, it) => {
			const prevQty = Number(it.previous_qty || 0);
			const thisBillQty = Number(it.this_bill_qty ?? (Number(it.cumulative_qty || 0) - prevQty));
			return acc + (thisBillQty * Number(it.rate || 0));
		}, 0);
	}, [items]);

	const otherAdditionsTotal = useMemo(() => {
		return additions.reduce((acc, a) => acc + Number(a.amount || 0), 0);
	}, [additions]);

	const billableValue = useMemo(() => {
		return grossWorkValue + otherAdditionsTotal;
	}, [grossWorkValue, otherAdditionsTotal]);

	const gstAmount = useMemo(() => {
		return applyGst ? (billableValue * Number(gstPercentage || 0)) / 100 : 0;
	}, [applyGst, billableValue, gstPercentage]);

	const totalInvoiceValue = useMemo(() => {
		return billableValue + gstAmount;
	}, [billableValue, gstAmount]);

	// ── Work Order Financial Summary Calculations ──
	const contractVal = Number(workOrder?.contract_value || workOrder?.total_boq_amount || 0);

	// Sum ALL advances from the advances child table (new model) with fallback to flat field
	const totalAdvancesDisbursed = useMemo(() => {
		const childSum = (workOrder?.advances || []).reduce(
			(acc: number, adv: any) => acc + Number(adv.amount || 0),
			0
		);
		return childSum || Number(workOrder?.mobilization_advance_amount || 0);
	}, [workOrder]);

	// Cumulative billed gross value across other submitted bills
	const billedToDate = useMemo(() => {
		const submitted = (siblingBills || []).filter((b: any) => b.docstatus === 1 && b.name !== billId);
		return submitted.reduce((acc: number, b: any) => acc + Number(b.gross_work_value || 0), 0);
	}, [siblingBills, billId]);

	// Prior advances recovered from previously submitted RA Bills
	const priorAdvanceRecovered = useMemo(() => {
		const submitted = (siblingBills || []).filter((b: any) => b.docstatus === 1 && b.name !== billId);
		return submitted.reduce((acc: number, b: any) => acc + Number(b.mobilization_recovery_amount || 0), 0);
	}, [siblingBills, billId]);

	const balancePendingToBill = Math.max(0, contractVal - billedToDate);

	// Available advance left to recover prior to this bill
	const availableBeforeThisBill = Math.max(0, totalAdvancesDisbursed - priorAdvanceRecovered);

	// Calculate live deductions based on rate % of billableValue (or advance amount for advance recoveries)
	const updatedDeductions = useMemo(() => {
		return deductions.map((d: any) => {
			let amt = Number(d.amount || 0);
			const isAdvRecovery = isAdvanceRecoveryType(d.deduction_type, d.description);
			const isPercentage =
				d.calculation_method === "Percentage" ||
				d.method === "Percentage" ||
				(!d.calculation_method && !d.method && d.rate !== undefined);

			if (isPercentage && d.rate !== undefined && d.rate !== null) {
				const rate = Number(d.rate || 0);
				if (isAdvRecovery) {
					let rowAdvAmt = Number(d.advance_amount || 0);
					if (!rowAdvAmt && workOrder?.advances) {
						const match = workOrder.advances.find((a: any) => {
							const dt = getAdvanceRecoveryDeductionType(a.advance_type);
							const desc = getAdvanceRecoveryDescription(a);
							return (d.deduction_type === dt && (!d.description || d.description === desc)) || d.description === desc;
						});
						if (match) rowAdvAmt = Number(match.amount || 0);
					}
					if (!rowAdvAmt) {
						rowAdvAmt = totalAdvancesDisbursed;
					}
					const targetRecovery = (rowAdvAmt * rate) / 100;
					amt = availableBeforeThisBill > 0 ? Math.min(targetRecovery, availableBeforeThisBill) : targetRecovery;
				} else {
					amt = (billableValue * rate) / 100;
				}
			}
			return { ...d, amount: amt };
		});
	}, [deductions, billableValue, totalAdvancesDisbursed, availableBeforeThisBill, workOrder]);

	// Single source of truth for this bill's advance recovery deduction (sum of all advance recovery rows)
	const currentBillAdvanceRecovery = useMemo(() => {
		const advRows = updatedDeductions.filter((d: any) => isAdvanceRecoveryType(d.deduction_type, d.description));
		if (advRows.length > 0) {
			return advRows.reduce((sum, d) => sum + Number(d.amount || 0), 0);
		}
		return Number(bill?.mobilization_recovery_amount || 0);
	}, [updatedDeductions, bill?.mobilization_recovery_amount]);

	// Total Advance Recovered to date (prior submitted bills + this bill's recovery)
	const advanceRecoveredToDate = useMemo(() => {
		return priorAdvanceRecovered + currentBillAdvanceRecovery;
	}, [priorAdvanceRecovered, currentBillAdvanceRecovery]);

	// Total Advance Pending recovery
	const advancePending = Math.max(0, totalAdvancesDisbursed - advanceRecoveredToDate);

	const totalDeductions = useMemo(() => {
		return updatedDeductions.reduce((acc, d) => acc + Number(d.amount || 0), 0);
	}, [updatedDeductions]);

	const netPayable = useMemo(() => {
		return totalInvoiceValue - totalDeductions;
	}, [totalInvoiceValue, totalDeductions]);

	if (isLoading) {
		return (
			<div className="p-8 space-y-6 animate-pulse">
				<div className="h-16 bg-white dark:bg-[#232333] rounded-2xl border border-slate-200 dark:border-[#32344d]"></div>
				<div className="h-32 bg-white dark:bg-[#232333] rounded-2xl border border-slate-200 dark:border-[#32344d]"></div>
				<div className="h-64 bg-white dark:bg-[#232333] rounded-2xl border border-slate-200 dark:border-[#32344d]"></div>
			</div>
		);
	}

	if (!bill) {
		return (
			<div className="p-12 text-center bg-white dark:bg-[#232333] rounded-2xl border border-slate-200 dark:border-[#32344d] text-rose-600 dark:text-[#ea5455]">
				RA Bill #{billId} not found.
			</div>
		);
	}

	const isDraft = bill.docstatus === 0;

	// ── CSV Download / Upload handlers for Measured Items ─────────────────────
	const handleDownloadItemsCSV = () => {
		const headers = "Item Code,Description,UOM,Rate,BOQ Qty,Previous Qty,This Bill Qty,Cumulative Qty,This Bill Amount\n";
		const rows = items.length > 0
			? items.map((it: any) => {
				const prevQty = Number(it.previous_qty || 0);
				const thisBillQty = Number(it.this_bill_qty ?? (Number(it.cumulative_qty || 0) - prevQty));
				const cumulativeQty = prevQty + thisBillQty;
				const rate = Number(it.rate || 0);
				return `"${it.item_code || ""}","${it.description || ""}","${it.uom || "Nos"}",${rate},${it.boq_qty || 0},${prevQty},${thisBillQty},${cumulativeQty},${(thisBillQty * rate).toFixed(2)}`;
			}).join("\n")
			: '"","","Nos",0,0,0,0,0,0';
		const blob = new Blob([headers + rows], { type: "text/csv;charset=utf-8;" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.setAttribute("download", `${billId}_items.csv`);
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	};

	const handleUploadItemsCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;

		const isExcel = file.name.toLowerCase().endsWith(".xlsx") || file.name.toLowerCase().endsWith(".xls");

		const mapRowObj = (rowObj: Record<string, any>) => {
			const keys = Object.keys(rowObj);
			const findVal = (matchers: string[]) => {
				for (const key of keys) {
					const norm = key.toLowerCase().replace(/[^a-z0-9]/g, "");
					if (matchers.some((m) => norm === m || norm.includes(m))) {
						return rowObj[key];
					}
				}
				return undefined;
			};

			const item_code = String(findVal(["itemcode", "code", "item"]) ?? "").trim();
			const description = String(findVal(["description", "desc", "itemdescription", "itemname"]) ?? "").trim() || item_code;
			const uom = String(findVal(["uom", "unit"]) ?? "").trim() || "Nos";
			const rate = Number(findVal(["unitrate", "rate", "price"]) ?? 0);
			const boq_qty = Number(findVal(["boqqty", "workorderqty", "quantity", "qty"]) ?? 0);
			const prev_val = findVal(["previousqty", "prevqty"]);
			const this_bill_val = findVal(["thisbillqty", "billqty", "currentqty"]);
			const cum_val = findVal(["cumulativeqty", "cumqty", "totalqty"]);

			const previous_qty = Number(prev_val ?? 0);
			let this_bill_qty = 0;
			let cumulative_qty = 0;

			if (this_bill_val !== undefined) {
				this_bill_qty = Number(this_bill_val);
				cumulative_qty = cum_val !== undefined ? Number(cum_val) : (previous_qty + this_bill_qty);
			} else if (cum_val !== undefined) {
				cumulative_qty = Number(cum_val);
				this_bill_qty = cumulative_qty - previous_qty;
			} else {
				cumulative_qty = previous_qty;
				this_bill_qty = 0;
			}
			const current_qty = this_bill_qty;

			if (item_code || description) {
				return { item_code, description, uom, rate, boq_qty, previous_qty, cumulative_qty, current_qty, this_bill_qty };
			}
			return null;
		};

		if (isExcel) {
			const reader = new FileReader();
			reader.onload = (evt) => {
				try {
					const data = new Uint8Array(evt.target?.result as ArrayBuffer);
					const wb = XLSX.read(data, { type: "array" });
					const wsName = wb.SheetNames[0];
					const ws = wb.Sheets[wsName];
					const jsonRows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });
					const parsedItems = jsonRows.map(mapRowObj).filter(Boolean);

					if (parsedItems.length > 0) {
						setItems(parsedItems);
					} else {
						alert("No valid item rows found in the uploaded Excel file.");
					}
				} catch (err: any) {
					console.error("Error parsing Excel items:", err);
					alert("Failed to parse Excel file: " + (err.message || String(err)));
				}
			};
			reader.readAsArrayBuffer(file);
		} else {
			const reader = new FileReader();
			reader.onload = (evt) => {
				const text = evt.target?.result as string;
				if (!text) return;
				const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
				if (lines.length < 2) {
					alert("CSV must have a header row and at least one data row.");
					return;
				}
				const headerRow = lines[0].split(",").map((h) => h.replace(/^"|"$/g, "").trim());
				const parsedItems: any[] = [];
				for (let i = 1; i < lines.length; i++) {
					const cols = lines[i].split(",").map((c) => c.replace(/^"|"$/g, "").trim());
					const rowObj: Record<string, any> = {};
					headerRow.forEach((h, idx) => {
						rowObj[h] = cols[idx];
					});
					const mapped = mapRowObj(rowObj);
					if (mapped) {
						parsedItems.push(mapped);
					}
				}
				if (parsedItems.length > 0) {
					setItems(parsedItems);
				} else {
					alert("No valid rows found in the uploaded CSV.");
				}
			};
			reader.readAsText(file);
		}
		e.target.value = "";
	};


	const handleItemChange = (index: number, field: string, value: any) => {
		const updated = [...items];
		const row = { ...updated[index], [field]: value };

		// This Bill Qty is the only field user directly edits.
		// Immediately and correctly recalculate cumulative_qty = previous_qty + this_bill_qty
		if (field === "this_bill_qty" || field === "rate") {
			const prevQty = Number(row.previous_qty || 0);
			const thisBillQty = Number(row.this_bill_qty || 0);
			const rate = Number(row.rate || 0);
			row.cumulative_qty = prevQty + thisBillQty;
			row.current_qty = thisBillQty;
			row.this_bill_amount = thisBillQty * rate;
			row.current_amount = thisBillQty * rate;
		} else if (field === "cumulative_qty") {
			const prevQty = Number(row.previous_qty || 0);
			const cumulativeQty = Number(row.cumulative_qty || 0);
			const rate = Number(row.rate || 0);
			row.this_bill_qty = cumulativeQty - prevQty;
			row.current_qty = cumulativeQty - prevQty;
			row.this_bill_amount = row.current_qty * rate;
			row.current_amount = row.this_bill_amount;
		}

		updated[index] = row;
		setItems(updated);
	};

	const handleAddItemRow = () => {
		setItems([
			...items,
			{
				item_code: "",
				description: "",
				uom: "Nos",
				rate: 0,
				boq_qty: 0,
				previous_qty: 0,
				this_bill_qty: 0,
				cumulative_qty: 0,
				current_qty: 0,
			},
		]);
		setEditingRowIndex(items.length);
	};

	const handleDuplicateRow = (index: number) => {
		const target = items[index];
		const duplicated = { ...target };
		const updated = [...items];
		updated.splice(index + 1, 0, duplicated);
		setItems(updated);
		setEditingRowIndex(index + 1);
	};

	const emptyItemRow = () => ({
		item_code: "",
		description: "",
		uom: "Nos",
		rate: 0,
		boq_qty: 0,
		previous_qty: 0,
		this_bill_qty: 0,
		cumulative_qty: 0,
		current_qty: 0,
	});

	const handleInsertAbove = (index: number) => {
		const updated = [...items];
		updated.splice(index, 0, emptyItemRow());
		setItems(updated);
		setEditingRowIndex(index);
	};

	const handleInsertBelow = (index: number) => {
		const updated = [...items];
		updated.splice(index + 1, 0, emptyItemRow());
		setItems(updated);
		setEditingRowIndex(index + 1);
	};

	const handleDeleteRow = (index: number) => {
		setItems(items.filter((_, i) => i !== index));
		if (editingRowIndex === index) setEditingRowIndex(null);
	};

	// Save & Submit Actions
	const handleSaveDraft = async () => {
		const payload = {
			posting_date: postingDate,
			ra_bill_no: Number(raBillNo),
			is_final_bill: isFinalBill ? 1 : 0,
			billing_method: billingMethod,
			apply_gst: applyGst ? 1 : 0,
			gst_percentage: Number(gstPercentage),
			gross_work_value: grossWorkValue,
			billable_value: billableValue,
			gst_amount: gstAmount,
			total_invoice_value: totalInvoiceValue,
			total_deductions: totalDeductions,
			mobilization_recovery_amount: currentBillAdvanceRecovery,
			net_payable: netPayable,
			items: items.map((it) => {
				const prevQty = Number(it.previous_qty || 0);
				const thisBillQty = Number(it.this_bill_qty ?? (Number(it.cumulative_qty || 0) - prevQty));
				const cumulativeQty = prevQty + thisBillQty;
				return {
					// Preserve the server-side child row name so Frappe updates (not re-inserts) each row
					...(it.name ? { name: it.name } : {}),
					...(it.boq_item ? { boq_item: it.boq_item } : {}),
					item_code: it.item_code,
					description: it.description,
					uom: it.uom,
					rate: Number(it.rate),
					boq_qty: Number(it.boq_qty || 0),
					// previous_qty is read-only (set by server from previous RA Bill)
					previous_qty: prevQty,
					// cumulative_qty is accurately calculated: previous_qty + this_bill_qty
					cumulative_qty: cumulativeQty,
				};
			}),
			additions: (additions || []).map((a: any) => ({
				...(a.name ? { name: a.name } : {}),
				addition_type: a.addition_type || "Other",
				description: a.description || "",
				method: a.method || a.calculation_method || "Percentage",
				calculation_method: a.calculation_method || a.method || "Percentage",
				rate: Number(a.rate || 0),
				amount: Number(a.amount || 0),
				...(a.account ? { account: a.account } : {}),
			})),
			deductions: updatedDeductions.map((d: any) => {
				let dt = d.deduction_type;
				let desc = d.description || d.deduction_type;
				if (dt === "Mobilization Advance Recovery" || dt === "Mobilization Advance") {
					dt = "Mobilization Recovery";
					desc = desc || "Mobilization Advance";
				} else if (dt === "Ad Hoc Advance Recovery" || dt === "Ad Hoc Advance") {
					dt = "Advance Recovery";
					desc = desc || "Ad Hoc Advance";
				} else if (typeof dt === "string" && dt.startsWith("Other -")) {
					dt = "Other";
					desc = desc || dt;
				}
				const methodVal = d.method || d.calculation_method || "Percentage";
				return {
					...(d.name ? { name: d.name } : {}),
					deduction_type: dt,
					description: desc,
					method: methodVal,
					calculation_method: methodVal,
					rate: Number(d.rate || 0),
					amount: Number(d.amount || 0),
					...(d.account ? { account: d.account } : {}),
					...(d.payment_entry ? { payment_entry: d.payment_entry } : {}),
					...(d.cap_percentage !== undefined ? { cap_percentage: Number(d.cap_percentage) } : {}),
				};
			}),
		};

		// Re-throw on failure so callers (handleSubmitBill, handleApplyWorkflowAction) can abort
		try {
			await updateDoc("RA Bill", billId, payload);
			mutate();
		} catch (err: any) {
			const parsed = parseFrappeError(err, "Save Failed");
			const cleanErr: any = new Error(parsed.message);
			if (err && typeof err === "object") {
				Object.assign(cleanErr, err);
			}
			cleanErr.parsedTitle = parsed.title;
			cleanErr.parsedIndicator = parsed.indicator;
			throw cleanErr;
		}
	};

	const handleSaveDraftAndAlert = async () => {
		try {
			await handleSaveDraft();
		} catch (err: any) {
			console.error("Save RA Bill draft error:", err);
			const parsed = parseFrappeError(err, "Save Draft Failed");
			setFeedbackModal({
				title: parsed.title || "Save Draft Failed",
				message: parsed.message,
				indicator: parsed.indicator,
			});
		}
	};

	const handleSubmitBill = async () => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		try {
			// Save first; if save fails this will throw and skip submit
			await handleSaveDraft();
			// Use server-side submit to avoid timestamp mismatch
			await callFrappeMethod("ra_bill.api.submit_document", { doctype: "RA Bill", name: billId });
			mutate();
		} catch (err: any) {
			console.error("RA Bill submit error:", err);
			const parsed = parseFrappeError(err, "Submit Failed");
			setFeedbackModal({
				title: parsed.title || "Submit Failed",
				message: parsed.message,
				indicator: parsed.indicator,
			});
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleApplyWorkflowAction = async (action: string) => {
		if (isApplyingWorkflow) return;
		setIsApplyingWorkflow(true);
		try {
			if (bill.docstatus === 0) {
				await handleSaveDraft();
			}
			await callFrappeMethod("ra_bill.api.apply_workflow_action", {
				doctype: "RA Bill",
				name: billId,
				action,
			});
			mutate();
			fetchWorkflowDetails();
		} catch (err: any) {
			console.error(`Workflow Action "${action}" error:`, err);
			const parsed = parseFrappeError(err, `Workflow Action "${action}" Failed`);
			setFeedbackModal({
				title: parsed.title || `Workflow Action "${action}" Failed`,
				message: parsed.message,
				indicator: parsed.indicator,
			});
		} finally {
			setIsApplyingWorkflow(false);
		}
	};

	const currentStatusLabel = (workflowData?.has_workflow
		? (workflowData.workflow_state || bill?.workflow_state || (bill?.docstatus === 1 ? "Approved" : "Draft"))
		: (bill?.docstatus === 1 ? "Approved" : bill?.docstatus === 2 ? "Cancelled" : "Draft")) || "Draft";

	const getStatusBadgeStyle = (status?: string | null) => {
		const lower = (status || "Draft").toLowerCase();
		if (lower.includes("approved") || lower.includes("submitted")) {
			return "bg-emerald-500/15 text-emerald-600 border-emerald-500/30";
		}
		if (lower.includes("reject") || lower.includes("cancel")) {
			return "bg-rose-500/15 text-rose-600 border-rose-500/30";
		}
		if (lower.includes("pending") || lower.includes("check") || lower.includes("certif")) {
			return "bg-indigo-500/15 text-indigo-600 border-indigo-500/30";
		}
		return "bg-amber-500/15 text-amber-600 border-amber-500/30";
	};

	const handleCreateInvoice = async () => {
		if (isCreatingInvoice) return;
		setIsCreatingInvoice(true);
		try {
			const res = await callFrappeMethod("ra_bill.api.create_rab_invoice", { ra_bill: billId });
			const invId = res.invoice_name || res;
			if (onCreateInvoiceSuccess) {
				onCreateInvoiceSuccess(invId);
			}
			mutate();
		} catch (err: any) {
			console.error("Create RAB Invoice error:", err);
			const parsed = parseFrappeError(err, "Create RAB Invoice Failed");
			setFeedbackModal({
				title: parsed.title || "Create RAB Invoice Failed",
				message: parsed.message,
				indicator: parsed.indicator,
			});
		} finally {
			setIsCreatingInvoice(false);
		}
	};

	const isApproved = bill.docstatus === 1 || currentStatusLabel.toLowerCase().includes("approved");
	const linkedInvoice = bill.purchase_invoice || bill.sales_invoice;

	return (
		<div className="space-y-6 text-slate-800 dark:text-slate-100 transition-colors duration-200 pb-12">
			{/* 1. HEADER & QUICK ACTIONS BAR */}
			<div className="flex flex-wrap items-center justify-between bg-white dark:bg-[#232333] p-5 rounded-2xl border border-slate-200/80 dark:border-[#32344d] gap-4 shadow-sm">
				<div className="flex items-center gap-4">
					<button
						onClick={onBack}
						className="p-2.5 bg-slate-100 dark:bg-[#1e1e2d] hover:bg-slate-200 dark:hover:bg-[#282a42] text-slate-700 dark:text-slate-200 rounded-xl border border-slate-200 dark:border-[#32344d] transition flex items-center gap-2 text-xs font-semibold"
					>
						<ArrowLeft size={16} />
						<span>Back</span>
					</button>
					<div>
						<div className="flex items-center gap-2.5">
							<h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">{bill.name}</h2>
							<span className={`px-3 py-0.5 rounded-full text-xs font-bold border ${getStatusBadgeStyle(currentStatusLabel)}`}>
								{currentStatusLabel}
							</span>
						</div>
						<p className="text-xs text-slate-500 dark:text-[#8f93a7] mt-0.5">
							Project: <span className="font-bold text-slate-800 dark:text-slate-200">{bill.project || "RISE"}</span> | WO:{" "}
							<span className="font-mono text-indigo-600 dark:text-[#7367f0]">{bill.boq || "-"}</span>
						</p>
					</div>
				</div>

				{/* Header Actions: Save Draft, Workflow Actions, and Create Invoice */}
				<div className="flex flex-wrap items-center gap-2 text-xs">
					{isDraft && (
						<button
							onClick={handleSaveDraftAndAlert}
							disabled={isSaving}
							className="px-4 py-2 bg-slate-100 dark:bg-[#1e1e2d] hover:bg-slate-200 dark:hover:bg-[#282a42] text-slate-800 dark:text-slate-200 font-bold rounded-xl border border-slate-200 dark:border-[#32344d] transition flex items-center gap-1.5"
						>
							<Save size={15} />
							<span>{isSaving ? "Saving..." : "Save Draft"}</span>
						</button>
					)}

					{/* Create or View RAB Invoice Button for Approved RA Bills */}
					{isApproved && (
						linkedInvoice ? (
							<button
								onClick={() => onCreateInvoiceSuccess && onCreateInvoiceSuccess(linkedInvoice)}
								className="px-4 py-2 bg-indigo-600 dark:bg-[#7367f0] hover:bg-indigo-700 dark:hover:bg-[#685dd8] text-white font-bold rounded-xl shadow-md transition flex items-center gap-1.5 cursor-pointer"
							>
								<Receipt size={15} />
								<span>View RAB Invoice ({linkedInvoice})</span>
							</button>
						) : (
							<button
								onClick={handleCreateInvoice}
								disabled={isCreatingInvoice}
								className="px-4 py-2 bg-emerald-600 dark:bg-[#28c76f] hover:bg-emerald-700 dark:hover:bg-[#24b263] text-white font-bold rounded-xl shadow-md transition flex items-center gap-1.5 cursor-pointer"
							>
								<Receipt size={15} />
								<span>{isCreatingInvoice ? "Creating Invoice..." : "Create RAB Invoice"}</span>
							</button>
						)
					)}

					{/* Frappe Workflow Transition Actions (Role-Based) */}
					{workflowData?.has_workflow && workflowData.transitions && workflowData.transitions.length > 0 ? (
						workflowData.transitions.map((t) => (
							<button
								key={t.action}
								onClick={() => handleApplyWorkflowAction(t.action)}
								disabled={isApplyingWorkflow || isSaving}
								className="px-4 py-2 bg-indigo-600 dark:bg-[#7367f0] hover:bg-indigo-700 dark:hover:bg-[#685dd8] text-white font-bold rounded-xl shadow-md transition flex items-center gap-1.5 cursor-pointer"
							>
								<CheckCircle2 size={15} />
								<span>{isApplyingWorkflow ? "Processing..." : t.action}</span>
							</button>
						))
					) : (
						isDraft && (
							<button
								onClick={handleSubmitBill}
								disabled={isSubmitting}
								className="px-4 py-2 bg-emerald-600 dark:bg-[#28c76f] hover:bg-emerald-700 dark:hover:bg-[#24b263] text-white font-bold rounded-xl shadow-md transition flex items-center gap-1.5 cursor-pointer"
							>
								<CheckCircle2 size={15} />
								<span>{isSubmitting ? "Submitting..." : "Submit RA Bill"}</span>
							</button>
						)
					)}

					<button className="p-2 bg-slate-100 dark:bg-[#1e1e2d] hover:bg-slate-200 text-slate-600 dark:text-slate-300 rounded-xl border border-slate-200 dark:border-[#32344d]" title="Print">
						<Printer size={15} />
					</button>
				</div>
			</div>

			{/* 1b. WORK ORDER FINANCIAL SUMMARY CARDS */}
			<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
				{/* Contract Value */}
				<div className="bg-white dark:bg-[#232333] p-4 rounded-2xl border border-slate-200/80 dark:border-[#32344d] shadow-sm">
					<p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-[#8f93a7]">Contract Value</p>
					<p className="text-base font-extrabold text-slate-900 dark:text-slate-100 mt-1">
						{workOrder ? formatCurrency(contractVal) : <span className="text-slate-300 dark:text-slate-600 text-xs">Loading…</span>}
					</p>
					<p className="text-[9px] text-slate-400 dark:text-[#8f93a7] mt-0.5 truncate">{workOrder?.name || bill.boq || "—"}</p>
				</div>

				{/* Billed to Date */}
				<div className="bg-white dark:bg-[#232333] p-4 rounded-2xl border border-slate-200/80 dark:border-[#32344d] shadow-sm">
					<p className="text-[9px] font-bold uppercase tracking-wider text-indigo-500">Billed to Date</p>
					<p className="text-base font-extrabold text-indigo-600 dark:text-[#7367f0] mt-1">{formatCurrency(billedToDate)}</p>
					<p className="text-[9px] text-slate-400 dark:text-[#8f93a7] mt-0.5">{(siblingBills || []).filter((b: any) => b.docstatus === 1).length} submitted bills</p>
				</div>

				{/* Balance Pending to Bill */}
				<div className={`p-4 rounded-2xl border shadow-sm ${
					balancePendingToBill <= 0
						? "bg-emerald-500/10 border-emerald-500/30"
						: "bg-amber-500/10 border-amber-500/30"
				}`}>
					<p className="text-[9px] font-bold uppercase tracking-wider text-amber-500">Balance Pending</p>
					<p className="text-base font-extrabold text-amber-600 dark:text-[#ff9f43] mt-1">{formatCurrency(balancePendingToBill)}</p>
					<p className="text-[9px] text-slate-400 dark:text-[#8f93a7] mt-0.5">= Contract − Billed</p>
				</div>

				{/* Advance Disbursed */}
				<div className="bg-white dark:bg-[#232333] p-4 rounded-2xl border border-slate-200/80 dark:border-[#32344d] shadow-sm">
					<p className="text-[9px] font-bold uppercase tracking-wider text-emerald-500">Advance Disbursed</p>
					<p className="text-base font-extrabold text-emerald-600 dark:text-[#28c76f] mt-1">{formatCurrency(totalAdvancesDisbursed)}</p>
					<p className="text-[9px] text-slate-400 dark:text-[#8f93a7] mt-0.5">Total advances (all types)</p>
				</div>

				{/* Advance Recovered */}
				<div className="bg-white dark:bg-[#232333] p-4 rounded-2xl border border-slate-200/80 dark:border-[#32344d] shadow-sm">
					<p className="text-[9px] font-bold uppercase tracking-wider text-rose-400">Advance Recovered</p>
					<p className="text-base font-extrabold text-rose-600 dark:text-[#ea5455] mt-1">{formatCurrency(advanceRecoveredToDate)}</p>
					<p className="text-[9px] text-slate-400 dark:text-[#8f93a7] mt-0.5">Across all bills</p>
				</div>

				{/* Advance Pending Recovery */}
				<div className={`p-4 rounded-2xl border shadow-sm ${
					advancePending <= 0
						? "bg-emerald-500/10 border-emerald-500/30"
						: "bg-rose-500/10 border-rose-500/30"
				}`}>
					<p className="text-[9px] font-bold uppercase tracking-wider text-rose-500">Advance Pending</p>
					<p className="text-base font-extrabold text-rose-700 dark:text-[#ea5455] mt-1">{formatCurrency(advancePending)}</p>
					<p className="text-[9px] text-slate-400 dark:text-[#8f93a7] mt-0.5">= Disbursed − Recovered</p>
				</div>
			</div>

			{/* 2. PRIMARY DETAILS (Editable Inputs) */}
			<div className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] rounded-2xl p-6 shadow-sm space-y-4">
				<h3 className="font-bold text-base text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-[#32344d] pb-3">Primary Details</h3>
				<div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
					{/* Left Column */}
					<div className="space-y-4">
						<div>
							<label className="block text-slate-500 dark:text-[#8f93a7] font-semibold mb-1">Project</label>
							<input
								type="text"
								value={bill.project || ""}
								readOnly
								className="w-full p-2.5 bg-slate-100 dark:bg-[#1e1e2d] border border-slate-200 dark:border-[#2d2d3f] rounded-xl text-slate-700 dark:text-slate-300 cursor-not-allowed font-semibold"
							/>
						</div>

						<div>
							<label className="block text-slate-500 dark:text-[#8f93a7] font-semibold mb-1">Work Order (BOQ)</label>
							<input
								type="text"
								value={bill.boq || bill.work_order || ""}
								readOnly
								className="w-full p-2.5 bg-slate-100 dark:bg-[#1e1e2d] border border-slate-200 dark:border-[#2d2d3f] rounded-xl text-indigo-600 dark:text-[#7367f0] cursor-not-allowed font-mono font-bold"
							/>
						</div>

						<div>
							<label className="block text-slate-500 dark:text-[#8f93a7] font-semibold mb-1">Bill Type</label>
							<input
								type="text"
								value={bill.bill_type || "Subcontractor"}
								readOnly
								className="w-full p-2.5 bg-slate-100 dark:bg-[#1e1e2d] border border-slate-200 dark:border-[#2d2d3f] rounded-xl text-slate-700 dark:text-slate-300 cursor-not-allowed"
							/>
						</div>
					</div>

					{/* Right Column */}
					<div className="space-y-4">
						<div>
							<label className="block text-slate-500 dark:text-[#8f93a7] font-semibold mb-1">Posting Date *</label>
							<input
								type="date"
								disabled={!isDraft}
								value={postingDate}
								onChange={(e) => setPostingDate(e.target.value)}
								className="w-full p-2.5 bg-white dark:bg-[#1e1e2d] border border-slate-200 dark:border-[#32344d] rounded-xl text-slate-900 dark:text-slate-100 font-semibold focus:outline-none focus:border-indigo-600"
							/>
						</div>

						<div>
							<label className="block text-slate-500 dark:text-[#8f93a7] font-semibold mb-1">RA Bill No. *</label>
							<input
								type="number"
								disabled={!isDraft}
								value={raBillNo === 0 ? "" : raBillNo}
								onChange={(e) => setRaBillNo(e.target.value === "" ? "" : Number(e.target.value))}
								className="w-full p-2.5 bg-white dark:bg-[#1e1e2d] border border-slate-200 dark:border-[#32344d] rounded-xl font-bold text-indigo-600 dark:text-[#7367f0] focus:outline-none"
							/>
						</div>

						<div className="pt-2 flex items-center gap-3">
							<input
								type="checkbox"
								id="isFinalBillDetail"
								disabled={!isDraft}
								checked={isFinalBill}
								onChange={(e) => setIsFinalBill(e.target.checked)}
								className="w-4 h-4 rounded text-indigo-600 focus:ring-0 cursor-pointer"
							/>
							<label htmlFor="isFinalBillDetail" className="font-bold text-slate-800 dark:text-slate-200 cursor-pointer">
								Is Final Bill
							</label>
						</div>
					</div>
				</div>
			</div>

			{/* 3. MEASURED ITEMS TABLE (`items`) */}
			<div className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] rounded-2xl overflow-hidden shadow-sm space-y-0">
				<div className="p-5 border-b border-slate-200 dark:border-[#32344d] flex flex-wrap justify-between items-center gap-3">
					<div>
						<h3 className="font-bold text-base text-slate-900 dark:text-slate-100">Measured Items (Cumulative)</h3>
						<p className="text-xs text-slate-500 dark:text-[#8f93a7]">Type billed quantity directly or open Row Editor for item details</p>
					</div>

					<div className="flex flex-wrap items-center gap-2">
						{/* CSV download — always visible */}
						<button
							type="button"
							onClick={handleDownloadItemsCSV}
							className="px-3 py-1.5 bg-white dark:bg-[#1e1e2d] hover:bg-slate-100 dark:hover:bg-[#282a42] text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-xl border border-slate-200 dark:border-[#32344d] transition flex items-center gap-1.5"
							title="Download current items as CSV"
						>
							<Download size={13} /> Export CSV
						</button>

						{/* CSV upload — draft only */}
						{isDraft && (
							<>
								<button
									type="button"
									onClick={() => itemsFileInputRef.current?.click()}
									className="px-3 py-1.5 bg-indigo-50 dark:bg-[#7367f0]/15 hover:bg-indigo-100 dark:hover:bg-[#7367f0]/25 text-indigo-600 dark:text-[#7367f0] text-xs font-semibold rounded-xl border border-indigo-200 dark:border-[#7367f0]/30 transition flex items-center gap-1.5"
									title="Import measured quantities from CSV"
								>
									<Upload size={13} /> Import CSV
								</button>
								<input
									type="file"
									accept=".csv,.xlsx,.xls"
									ref={itemsFileInputRef}
									onChange={handleUploadItemsCSV}
									className="hidden"
								/>
								<button
									onClick={handleAddItemRow}
									className="px-3.5 py-2 bg-indigo-600 dark:bg-[#7367f0] hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5"
								>
									<Plus size={14} /> Add Item Row
								</button>
							</>
						)}
					</div>
				</div>

				<div className="overflow-x-auto">
					<table className="w-full text-left text-xs">
						<thead className="bg-slate-100 dark:bg-[#1e1e2d] text-slate-600 dark:text-[#8f93a7] uppercase font-bold border-b border-slate-200 dark:border-[#32344d]">
							<tr>
								<th className="p-3.5 w-10">No.</th>
								<th className="p-3.5">Item Code / Description</th>
								<th className="p-3.5 font-mono">UOM</th>
								<th className="p-3.5 text-right">Work Order Qty</th>
								<th className="p-3.5 text-right">Rate (INR)</th>
								<th className="p-3.5 text-right">Previous Qty</th>
								<th className="p-3.5 text-right">This Bill Qty *</th>
								<th className="p-3.5 text-right">Cumulative Qty</th>
								<th className="p-3.5 text-right">This Bill Amount</th>
								<th className="p-3.5 text-center">Row Editor</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-200/80 dark:divide-[#2d2d3f]">
							{items && items.length > 0 ? (
								items.map((it: any, idx: number) => {
									const isRowEditing = editingRowIndex === idx;
									return (
										<React.Fragment key={idx}>
											<tr className="hover:bg-slate-50/80 dark:hover:bg-[#1e1e2d]/70 transition">
												<td className="p-3.5 text-slate-400 font-semibold">{idx + 1}</td>
												<td className="p-3.5 text-slate-800 dark:text-slate-200 max-w-xs">
													<ItemLinkDropdown
														value={it.item_code || ""}
														onChange={(sel) => {
															handleItemChange(idx, "item_code", sel.item_code);
															handleItemChange(idx, "description", sel.description);
															handleItemChange(idx, "uom", sel.uom);
														}}
													/>
													<p className="text-[11px] text-slate-500 dark:text-[#8f93a7] mt-1 line-clamp-2">{it.description}</p>
												</td>
												<td className="p-3.5 font-mono text-slate-600 dark:text-slate-300">{it.uom || "Nos"}</td>
												<td className="p-3.5 text-right font-mono font-medium text-slate-700 dark:text-slate-300">
													{it.boq_qty ?? 0}
												</td>
												<td className="p-3.5 text-right">
													{isDraft ? (
														<input
															type="number"
															step="any"
															value={it.rate === 0 ? "" : (it.rate ?? "")}
															onChange={(e) => handleItemChange(idx, "rate", e.target.value === "" ? 0 : Number(e.target.value))}
															className="w-24 p-1.5 bg-white dark:bg-[#1e1e2d] border border-slate-200 dark:border-[#32344d] rounded-lg font-mono text-right text-slate-900 dark:text-slate-100"
														/>
													) : (
														<span className="font-mono font-medium">{formatCurrency(it.rate)}</span>
													)}
												</td>
												<td className="p-3.5 text-right text-slate-400 font-mono">{it.previous_qty || 0}</td>
												
												{/* This Bill Qty — the ONLY user-editable field */}
												<td className="p-3.5 text-right">
													{isDraft ? (
														<input
															type="number"
															step="any"
															value={it.this_bill_qty === 0 ? "" : (it.this_bill_qty ?? "")}
															onChange={(e) => handleItemChange(idx, "this_bill_qty", e.target.value === "" ? 0 : Number(e.target.value))}
															className="w-28 p-1.5 bg-white dark:bg-[#1e1e2d] border-2 border-indigo-500/60 dark:border-[#7367f0] rounded-lg font-mono font-bold text-right text-indigo-600 dark:text-[#7367f0] focus:outline-none"
															placeholder="0"
														/>
													) : (
														<span className="font-mono font-bold text-indigo-600 dark:text-[#7367f0]">
															{it.this_bill_qty ?? (Number(it.cumulative_qty || 0) - Number(it.previous_qty || 0))}
														</span>
													)}
												</td>

												{/* Cumulative Qty — auto-calculated and strictly READ-ONLY */}
												<td className="p-3.5 text-right font-mono font-bold text-slate-700 dark:text-slate-300">
													{Number(it.previous_qty || 0) + Number(it.this_bill_qty ?? (Number(it.cumulative_qty || 0) - Number(it.previous_qty || 0)))}
												</td>

												{/* This Bill Amount = this_bill_qty × rate */}
												<td className="p-3.5 text-right font-mono font-bold text-indigo-600 dark:text-[#7367f0]">
													{formatCurrency(Number(it.this_bill_qty ?? (Number(it.cumulative_qty || 0) - Number(it.previous_qty || 0))) * Number(it.rate || 0))}
												</td>

												<td className="p-3.5 text-center">
													<button
														type="button"
														onClick={() => setEditingRowIndex(isRowEditing ? null : idx)}
														className="p-1.5 bg-slate-100 dark:bg-[#1e1e2d] hover:bg-indigo-50 dark:hover:bg-[#7367f0]/20 text-slate-500 dark:text-[#8f93a7] hover:text-indigo-600 dark:hover:text-[#7367f0] rounded-lg transition"
														title="Open Editing Row Card"
													>
														<Edit3 size={15} />
													</button>
												</td>
											</tr>

											{/* Standard ERPNext Child Table Inline Row Editor ("Editing Row #X") */}
											{isRowEditing && (
												<tr>
													<td colSpan={10} className="p-0 border-b-2 border-indigo-500">
														<RowEditorModal
															rowIndex={idx}
															totalRows={items.length}
															mode="bill"
															row={it}
															onChange={(updatedRow) => {
																const copy = [...items];
																copy[idx] = updatedRow;
																setItems(copy);
															}}
															onDelete={() => handleDeleteRow(idx)}
															onInsertAbove={() => handleInsertAbove(idx)}
															onInsertBelow={() => handleInsertBelow(idx)}
															onDuplicate={() => handleDuplicateRow(idx)}
															onClose={() => setEditingRowIndex(null)}
														/>
													</td>
												</tr>
											)}
										</React.Fragment>
									);
								})
							) : (
								<tr>
									<td colSpan={10} className="p-8 text-center text-slate-400">
										No measured items attached. Click "+ Add Item Row" to add items.
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</div>

			{/* 4. BILL VALUE & TAX SUMMARY (Live Recalculation Grid) */}
			<div className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] rounded-2xl p-6 shadow-sm space-y-4">
				<h3 className="font-bold text-base text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-[#32344d] pb-3">Bill Valuation & Live Tax Breakdown</h3>
				<div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
					{/* Left Column */}
					<div className="space-y-3 bg-slate-50 dark:bg-[#1e1e2d] p-5 rounded-xl border border-slate-200/70 dark:border-[#2d2d3f]">
						<div className="flex justify-between items-center border-b border-slate-200 dark:border-[#2d2d3f] pb-2">
							<span className="text-slate-600 dark:text-[#8f93a7]">Gross Work Value (This Bill):</span>
							<span className="font-mono font-bold text-slate-900 dark:text-slate-100 text-sm">{formatCurrency(grossWorkValue)}</span>
						</div>
						<div className="flex justify-between items-center border-b border-slate-200 dark:border-[#2d2d3f] pb-2">
							<span className="text-slate-600 dark:text-[#8f93a7]">Other Additions Total:</span>
							<span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{formatCurrency(otherAdditionsTotal)}</span>
						</div>
						<div className="pt-2 flex justify-between items-center">
							<span className="font-bold text-slate-800 dark:text-slate-200">Billable Value (Taxable Base):</span>
							<span className="font-mono font-black text-indigo-600 dark:text-[#7367f0] text-sm">{formatCurrency(billableValue)}</span>
						</div>
					</div>

					{/* Right Column */}
					<div className="space-y-3 bg-slate-50 dark:bg-[#1e1e2d] p-5 rounded-xl border border-slate-200/70 dark:border-[#2d2d3f]">
						<div className="flex justify-between items-center border-b border-slate-200 dark:border-[#2d2d3f] pb-2">
							<span className="text-slate-600 dark:text-[#8f93a7]">Apply GST:</span>
							<div className="flex items-center gap-2">
								<input
									type="checkbox"
									disabled={!isDraft}
									checked={applyGst}
									onChange={(e) => setApplyGst(e.target.checked)}
									className="rounded text-indigo-600 focus:ring-0 cursor-pointer"
								/>
								<span className="font-semibold">{applyGst ? "Yes" : "No"}</span>
							</div>
						</div>
						<div className="flex justify-between items-center border-b border-slate-200 dark:border-[#2d2d3f] pb-2">
							<span className="text-slate-600 dark:text-[#8f93a7]">GST %:</span>
							{isDraft ? (
								<input
									type="number"
									step="any"
									value={gstPercentage === 0 ? "" : gstPercentage}
									onChange={(e) => setGstPercentage(e.target.value === "" ? 0 : Number(e.target.value))}
									className="w-20 p-1 bg-white dark:bg-[#232333] border border-slate-200 dark:border-[#32344d] rounded font-mono text-right"
								/>
							) : (
								<span className="font-mono font-bold">{gstPercentage}%</span>
							)}
						</div>
						<div className="flex justify-between items-center border-b border-slate-200 dark:border-[#2d2d3f] pb-2">
							<span className="text-slate-600 dark:text-[#8f93a7]">GST Amount (Live):</span>
							<span className="font-mono font-bold text-slate-900 dark:text-slate-100">{formatCurrency(gstAmount)}</span>
						</div>
						<div className="pt-2 flex justify-between items-center">
							<span className="font-bold text-slate-800 dark:text-slate-200">Total Invoice Value:</span>
							<span className="font-mono font-black text-indigo-600 dark:text-[#7367f0] text-sm">{formatCurrency(totalInvoiceValue)}</span>
						</div>
					</div>
				</div>
			</div>

			{/* 5. DEDUCTIONS & RECOVERIES TABLE (`deductions`) */}
			<div className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] rounded-2xl overflow-hidden shadow-sm space-y-0">
				<div className="p-5 border-b border-slate-200 dark:border-[#32344d] flex justify-between items-center">
					<div>
						<h3 className="font-bold text-base text-slate-900 dark:text-slate-100">Deductions & Recoveries</h3>
						<p className="text-xs text-slate-500 dark:text-[#8f93a7]">Calculated dynamically based on rate % or fixed amounts</p>
					</div>

					{isDraft && (
						<button
							onClick={() =>
								setDeductions([
									...deductions,
									{ deduction_type: "Other", description: "Other Recovery", method: "Percentage", calculation_method: "Percentage", rate: 0, amount: 0 },
								])
							}
							className="px-3.5 py-1.5 bg-slate-100 dark:bg-[#1e1e2d] hover:bg-slate-200 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold transition flex items-center gap-1"
						>
							<Plus size={14} /> Add Deduction Row
						</button>
					)}
				</div>

				<div className="p-6">
					<div className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-xs">
						<div className="lg:col-span-2 overflow-x-auto">
							<table className="w-full text-left text-xs">
								<thead className="bg-slate-100 dark:bg-[#1e1e2d] text-slate-600 dark:text-[#8f93a7] uppercase font-bold border-b border-slate-200 dark:border-[#32344d]">
									<tr>
										<th className="p-3 w-10">No.</th>
										<th className="p-3">Deduction Type</th>
										<th className="p-3">Method</th>
										<th className="p-3 text-right">Rate %</th>
										<th className="p-3 text-right">Amount (INR)</th>
										{isDraft && <th className="p-3 text-center">Action</th>}
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-200 dark:divide-[#2d2d3f]">
									{updatedDeductions && updatedDeductions.length > 0 ? (
										updatedDeductions.map((d: any, idx: number) => (
											<tr key={idx} className="hover:bg-slate-50/80 dark:hover:bg-[#1e1e2d]/70 transition">
												<td className="p-3 text-slate-400 font-semibold">{idx + 1}</td>
												<td className="p-3 font-bold text-slate-900 dark:text-slate-100">
													<div>{d.description || d.deduction_type}</div>
													{d.description && d.description !== d.deduction_type && (
														<span className="text-[10px] text-slate-400 font-normal block">{d.deduction_type}</span>
													)}
												</td>
												<td className="p-3 text-slate-500">{d.calculation_method || d.method || "Percentage"}</td>
												<td className="p-3 text-right font-mono">
													{isDraft ? (
														<div className="flex items-center justify-end gap-1">
															<input
																type="number"
																step="any"
																min="0"
																value={d.rate === 0 ? "" : (d.rate ?? "")}
																onChange={(e) => {
																	const newRate = e.target.value === "" ? 0 : parseFloat(e.target.value) || 0;
																	setDeductions(
																		deductions.map((row, i) =>
																			i === idx ? { ...row, rate: newRate } : row
																		)
																	);
																}}
																className="w-20 p-1 bg-white dark:bg-[#1e1e2d] border border-slate-200 dark:border-[#32344d] rounded-lg font-mono text-right text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-600 dark:focus:border-[#7367f0]"
															/>
															<span className="text-slate-500 font-mono">%</span>
														</div>
													) : (
														<span>{d.rate || 0}%</span>
													)}
												</td>
												<td className="p-3 text-right font-mono font-bold text-rose-600 dark:text-[#ea5455]">
													-{formatCurrency(d.amount)}
												</td>
												{isDraft && (
													<td className="p-3 text-center">
														<button
															onClick={() => setDeductions(deductions.filter((_, i) => i !== idx))}
															className="text-rose-500 hover:text-rose-700"
														>
															<Trash2 size={14} />
														</button>
													</td>
												)}
											</tr>
										))
									) : (
										<tr>
											<td colSpan={6} className="p-4 text-center text-slate-400">No deductions attached.</td>
										</tr>
									)}
								</tbody>
							</table>
						</div>

						<div className="bg-slate-50 dark:bg-[#1e1e2d] p-5 rounded-xl border border-slate-200/70 dark:border-[#2d2d3f] space-y-3">
							<h4 className="font-bold text-xs text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-[#2d2d3f] pb-2">
								Live Net Payable Summary
							</h4>
							<div className="flex justify-between items-center text-slate-600 dark:text-[#8f93a7]">
								<span>Total Deductions:</span>
								<span className="font-mono font-bold text-rose-600 dark:text-[#ea5455]">-{formatCurrency(totalDeductions)}</span>
							</div>
							<div className="border-t border-dashed border-slate-300 dark:border-[#32344d] pt-3 mt-3 flex justify-between items-center">
								<span className="font-bold text-slate-800 dark:text-slate-200">Net Payable Amount:</span>
								<span className="font-mono font-black text-indigo-600 dark:text-[#7367f0] text-base">{formatCurrency(netPayable)}</span>
							</div>
							{/* Running Advance Recovery note */}
							{totalAdvancesDisbursed > 0 && (
								<div className="mt-3 pt-3 border-t border-dashed border-slate-300 dark:border-[#32344d] space-y-1.5 text-[10px]">
									<p className="font-bold text-slate-500 dark:text-[#8f93a7] uppercase tracking-wider">Advance Recovery Tracker</p>
									<div className="flex justify-between">
										<span className="text-slate-500">Total Disbursed:</span>
										<span className="font-mono font-semibold text-emerald-600 dark:text-[#28c76f]">{formatCurrency(totalAdvancesDisbursed)}</span>
									</div>
									<div className="flex justify-between">
										<span className="text-slate-500">Recovered to Date:</span>
										<span className="font-mono font-semibold text-rose-600 dark:text-[#ea5455]">-{formatCurrency(advanceRecoveredToDate)}</span>
									</div>
									<div className="flex justify-between border-t border-slate-200 dark:border-[#32344d] pt-1.5">
										<span className="font-bold text-slate-700 dark:text-slate-200">Still Outstanding:</span>
										<span className={`font-mono font-black ${ advancePending <= 0 ? "text-emerald-600 dark:text-[#28c76f]" : "text-rose-700 dark:text-[#ea5455]"}`}>{formatCurrency(advancePending)}</span>
									</div>
								</div>
							)}
						</div>
					</div>
				</div>
			</div>

			{/* 6. ALL RA BILLS FOR THIS WORK ORDER (Drill-down list) */}
			{woName && siblingBills && siblingBills.length > 0 && (
				<div className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] rounded-2xl overflow-hidden shadow-sm">
					<div className="p-5 border-b border-slate-200 dark:border-[#32344d] flex justify-between items-center">
						<div>
							<h3 className="font-bold text-base text-slate-900 dark:text-slate-100">All RA Bills — {woName}</h3>
							<p className="text-xs text-slate-500 dark:text-[#8f93a7]">All non-cancelled bills for this Work Order. Click a row to open it.</p>
						</div>
						<span className="text-xs font-bold bg-indigo-50 dark:bg-[#7367f0]/15 text-indigo-600 dark:text-[#7367f0] px-3 py-1 rounded-full border border-indigo-200 dark:border-[#7367f0]/30">
							{siblingBills.length} Bill(s)
						</span>
					</div>
					<div className="overflow-x-auto">
						<table className="w-full text-left text-xs">
							<thead className="bg-slate-100 dark:bg-[#1e1e2d] text-slate-600 dark:text-[#8f93a7] uppercase font-bold border-b border-slate-200 dark:border-[#32344d]">
								<tr>
									<th className="p-3.5">Bill ID</th>
									<th className="p-3.5">RA Bill No</th>
									<th className="p-3.5">Posting Date</th>
									<th className="p-3.5 text-right">Gross Work Value</th>
									<th className="p-3.5 text-right">Net Payable</th>
									<th className="p-3.5">Status</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-200/80 dark:divide-[#2d2d3f]">
								{(siblingBills as any[]).map((b) => {
									const isCurrent = b.name === billId;
									const stateLabel = b.workflow_state || (b.docstatus === 1 ? "Approved" : b.docstatus === 2 ? "Cancelled" : "Draft");
									return (
										<tr
											key={b.name}
											onClick={() => {
												if (!isCurrent && onSelectBill) onSelectBill(b.name);
											}}
											className={`transition ${
												isCurrent
													? "bg-indigo-50/60 dark:bg-[#7367f0]/10 border-l-4 border-indigo-500"
													: onSelectBill ? "hover:bg-slate-50/80 dark:hover:bg-[#1e1e2d]/70 cursor-pointer group" : ""
											}`}
										>
											<td className={`p-3.5 font-mono font-bold ${ isCurrent ? "text-indigo-700 dark:text-[#7367f0]" : "text-indigo-600 dark:text-[#7367f0] group-hover:underline"}`}>
												{b.name}{isCurrent && <span className="ml-1.5 text-[9px] bg-indigo-500 text-white px-1.5 py-0.5 rounded-full align-middle">Current</span>}
											</td>
											<td className="p-3.5 font-semibold text-slate-800 dark:text-slate-200">RA #{b.ra_bill_no || "—"}</td>
											<td className="p-3.5 text-slate-600 dark:text-[#8f93a7]">{b.posting_date || "—"}</td>
											<td className="p-3.5 text-right font-medium text-slate-900 dark:text-slate-100">{formatCurrency(b.gross_work_value)}</td>
											<td className="p-3.5 text-right font-bold text-indigo-600 dark:text-[#7367f0]">{formatCurrency(b.net_payable)}</td>
											<td className="p-3.5">
												<span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
													stateLabel.toLowerCase().includes("approved") || stateLabel.toLowerCase().includes("submitted")
														? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30"
														: stateLabel.toLowerCase().includes("draft")
															? "bg-amber-500/15 text-amber-600 border-amber-500/30"
															: "bg-indigo-500/15 text-indigo-600 border-indigo-500/30"
												}`}>{stateLabel}</span>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{feedbackModal && (
				<DeskMessageModal
					title={feedbackModal.title}
					message={feedbackModal.message}
					indicator={feedbackModal.indicator}
					onClose={() => setFeedbackModal(null)}
				/>
			)}
		</div>
	);
}
