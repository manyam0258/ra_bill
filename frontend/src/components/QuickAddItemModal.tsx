import { useState, useEffect, useRef, type FormEvent } from "react";
import { X, Loader2 } from "lucide-react";
import { DocLinkDropdown } from "./DocLinkDropdown";

function getFrappeCSRFToken(): string {
	const fromFrappe = (window as any).frappe?.csrf_token;
	if (fromFrappe && fromFrappe !== "Guest") return fromFrappe;
	const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
	if (match) return decodeURIComponent(match[1]);
	return "";
}

interface QuickAddItemModalProps {
	isOpen: boolean;
	onClose: () => void;
	onSuccess: (item: { item_code: string; item_name: string; stock_uom: string; item_group: string }) => void;
	initialItemCode?: string;
}

export function QuickAddItemModal({
	isOpen,
	onClose,
	onSuccess,
	initialItemCode = "",
}: QuickAddItemModalProps) {
	const [itemCode, setItemCode] = useState(initialItemCode);
	const [itemName, setItemName] = useState("");
	const [itemGroup, setItemGroup] = useState("");
	const [gstHsnCode, setGstHsnCode] = useState("");
	const [stockUom, setStockUom] = useState("Nos");
	const [maintainStock, setMaintainStock] = useState(true);
	const [isFixedAsset, setIsFixedAsset] = useState(false);

	const [isSubmitting, setIsSubmitting] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	// HSN Autocomplete suggestions
	const [hsnSuggestions, setHsnSuggestions] = useState<Array<{ value: string; description: string }>>([]);
	const [isSearchingHsn, setIsSearchingHsn] = useState(false);
	const [showHsnDropdown, setShowHsnDropdown] = useState(false);
	const hsnContainerRef = useRef<HTMLDivElement>(null);

	// Sync initialItemCode when modal opens or initialItemCode changes
	useEffect(() => {
		if (isOpen) {
			setItemCode(initialItemCode);
			setItemName("");
			setItemGroup("");
			setGstHsnCode("");
			setStockUom("Nos");
			setMaintainStock(true);
			setIsFixedAsset(false);
			setErrorMessage(null);
			setShowHsnDropdown(false);
		}
	}, [isOpen, initialItemCode]);

	// Close on Escape key
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape" && isOpen && !isSubmitting) {
				onClose();
			}
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isOpen, isSubmitting, onClose]);

	// Close HSN dropdown on outside click
	useEffect(() => {
		function handleClickOutside(e: MouseEvent) {
			if (hsnContainerRef.current && !hsnContainerRef.current.contains(e.target as Node)) {
				setShowHsnDropdown(false);
			}
		}
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	// Search HSN codes via Frappe desk search_link
	useEffect(() => {
		if (!gstHsnCode || gstHsnCode.length < 2) {
			setHsnSuggestions([]);
			return;
		}

		const timer = setTimeout(async () => {
			setIsSearchingHsn(true);
			try {
				const res = await fetch(
					`/api/method/frappe.desk.search.search_link?doctype=GST+HSN+Code&txt=${encodeURIComponent(gstHsnCode)}`,
					{
						headers: {
							"X-Frappe-CSRF-Token": getFrappeCSRFToken(),
						},
					}
				);
				if (res.ok) {
					const data = await res.json();
					if (Array.isArray(data.message)) {
						setHsnSuggestions(data.message);
						setShowHsnDropdown(data.message.length > 0);
					}
				}
			} catch (_) {
				// Ignore search network error
			} finally {
				setIsSearchingHsn(false);
			}
		}, 250);

		return () => clearTimeout(timer);
	}, [gstHsnCode]);

	if (!isOpen) return null;

	const handleSave = async (e?: FormEvent) => {
		if (e) e.preventDefault();
		setErrorMessage(null);

		const trimmedCode = itemCode.trim();
		const trimmedGroup = itemGroup.trim();
		const trimmedUom = stockUom.trim();
		const trimmedHsn = gstHsnCode.trim();

		if (!trimmedCode) {
			setErrorMessage("Item Code is required.");
			return;
		}
		if (!trimmedGroup) {
			setErrorMessage("Item Group is required.");
			return;
		}
		if (!trimmedHsn) {
			setErrorMessage("HSN/SAC is required.");
			return;
		}
		if (!trimmedUom) {
			setErrorMessage("Default Unit of Measure is required.");
			return;
		}

		setIsSubmitting(true);

		try {
			const payload = {
				doctype: "Item",
				item_code: trimmedCode,
				item_name: itemName.trim() || trimmedCode,
				item_group: trimmedGroup,
				gst_hsn_code: trimmedHsn,
				stock_uom: trimmedUom,
				is_stock_item: maintainStock ? 1 : 0,
				is_fixed_asset: isFixedAsset ? 1 : 0,
			};

			const response = await fetch("/api/method/frappe.client.insert", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Frappe-CSRF-Token": getFrappeCSRFToken(),
				},
				body: JSON.stringify({ doc: payload }),
			});

			if (!response.ok) {
				const errText = await response.text();
				let detail = errText;
				try {
					const errJson = JSON.parse(errText);
					if (errJson._server_messages) {
						const msgs = JSON.parse(errJson._server_messages);
						detail = msgs
							.map((m: string) => {
								try {
									return JSON.parse(m).message;
								} catch (_) {
									return m;
								}
							})
							.join(" | ");
					} else if (errJson.exception) {
						detail = errJson.exception.replace(/^[a-zA-Z0-9_.]+: /, "");
					} else if (errJson.message) {
						detail = typeof errJson.message === "string" ? errJson.message : JSON.stringify(errJson.message);
					}
				} catch (_) {}
				throw new Error(detail || "Failed to create Item record.");
			}

			const json = await response.json();
			const createdDoc = json.message ?? json;

			onSuccess({
				item_code: createdDoc.item_code || createdDoc.name || trimmedCode,
				item_name: createdDoc.item_name || itemName.trim() || trimmedCode,
				stock_uom: createdDoc.stock_uom || trimmedUom,
				item_group: createdDoc.item_group || trimmedGroup,
			});
			onClose();
		} catch (err: any) {
			setErrorMessage(err.message || "An unexpected error occurred while saving the Item.");
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleEditFullForm = () => {
		window.open("/app/item/new", "_blank");
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto animate-fadeIn">
			<div
				className="bg-white dark:bg-[#232333] border border-slate-200 dark:border-[#32344d] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden my-auto"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Dialog Header */}
				<div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/80 dark:border-[#32344d]">
					<h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
						New Item
					</h3>
					<button
						type="button"
						onClick={onClose}
						disabled={isSubmitting}
						className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition cursor-pointer"
						title="Close dialog"
					>
						<X size={18} />
					</button>
				</div>

				{/* Dialog Form Body */}
				<form onSubmit={handleSave} className="p-6 space-y-4 text-xs">
					{errorMessage && (
						<div className="p-3 bg-rose-50 dark:bg-rose-500/15 border border-rose-200 dark:border-rose-500/30 rounded-xl text-rose-700 dark:text-rose-400 font-semibold text-xs leading-relaxed">
							{errorMessage}
						</div>
					)}

					{/* 1. Item Code * */}
					<div className="space-y-1.5">
						<label className="block text-slate-700 dark:text-slate-200 font-semibold">
							Item Code <span className="text-rose-500">*</span>
						</label>
						<input
							type="text"
							value={itemCode}
							onChange={(e) => setItemCode(e.target.value)}
							placeholder="e.g. ITEM-001"
							autoFocus
							required
							className="w-full px-3.5 py-2.5 bg-slate-100/70 dark:bg-[#1e1e2d] border border-slate-200/90 dark:border-[#32344d] rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-indigo-500 dark:focus:border-[#7367f0] font-mono text-xs transition"
						/>
					</div>

					{/* 2. Item Name */}
					<div className="space-y-1.5">
						<label className="block text-slate-700 dark:text-slate-200 font-semibold">
							Item Name
						</label>
						<input
							type="text"
							value={itemName}
							onChange={(e) => setItemName(e.target.value)}
							placeholder="Descriptive name (defaults to Item Code if blank)"
							className="w-full px-3.5 py-2.5 bg-slate-100/70 dark:bg-[#1e1e2d] border border-slate-200/90 dark:border-[#32344d] rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-indigo-500 dark:focus:border-[#7367f0] text-xs transition"
						/>
					</div>

					{/* 3. Item Group * */}
					<div className="space-y-1.5">
						<label className="block text-slate-700 dark:text-slate-200 font-semibold">
							Item Group <span className="text-rose-500">*</span>
						</label>
						<DocLinkDropdown
							doctype="Item Group"
							value={itemGroup}
							onChange={(val) => setItemGroup(val)}
							placeholder="Select Item Group..."
							required
						/>
					</div>

					{/* 4. HSN/SAC * */}
					<div className="space-y-1.5 relative" ref={hsnContainerRef}>
						<label className="block text-slate-700 dark:text-slate-200 font-semibold">
							HSN/SAC <span className="text-rose-500">*</span>
						</label>
						<div className="relative">
							<input
								type="text"
								value={gstHsnCode}
								onChange={(e) => setGstHsnCode(e.target.value)}
								onFocus={() => {
									if (hsnSuggestions.length > 0) setShowHsnDropdown(true);
								}}
								placeholder="e.g. 9954 or search category..."
								required
								className="w-full px-3.5 py-2.5 bg-slate-100/70 dark:bg-[#1e1e2d] border border-slate-200/90 dark:border-[#32344d] rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-indigo-500 dark:focus:border-[#7367f0] font-mono text-xs transition pr-8"
							/>
							{isSearchingHsn && (
								<div className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">
									<Loader2 size={14} className="animate-spin" />
								</div>
							)}
						</div>
						<p className="text-[11px] text-slate-500 dark:text-[#8f93a7]">
							You can search code by the description of the category.
						</p>

						{/* Live HSN Suggestions Dropdown */}
						{showHsnDropdown && hsnSuggestions.length > 0 && (
							<div className="absolute left-0 top-full mt-1 w-full bg-white dark:bg-[#232333] border border-slate-200 dark:border-[#32344d] rounded-xl shadow-xl z-50 max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-[#2d2d3f]">
								{hsnSuggestions.map((item) => (
									<div
										key={item.value}
										onClick={() => {
											setGstHsnCode(item.value);
											setShowHsnDropdown(false);
										}}
										className="p-2 hover:bg-indigo-50 dark:hover:bg-[#7367f0]/15 cursor-pointer transition flex items-start gap-2"
									>
										<span className="font-mono font-bold text-indigo-600 dark:text-[#7367f0] shrink-0">
											{item.value}
										</span>
										<span className="text-[11px] text-slate-600 dark:text-slate-300 line-clamp-1">
											{item.description}
										</span>
									</div>
								))}
							</div>
						)}
					</div>

					{/* 5. Default Unit of Measure * */}
					<div className="space-y-1.5">
						<label className="block text-slate-700 dark:text-slate-200 font-semibold">
							Default Unit of Measure <span className="text-rose-500">*</span>
						</label>
						<DocLinkDropdown
							doctype="UOM"
							value={stockUom}
							onChange={(val) => setStockUom(val)}
							placeholder="Select Unit of Measure..."
							required
						/>
					</div>

					{/* 6. Maintain Stock (Checkbox) */}
					<div className="pt-1">
						<label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
							<input
								type="checkbox"
								checked={maintainStock}
								onChange={(e) => setMaintainStock(e.target.checked)}
								className="w-4 h-4 rounded border-slate-300 dark:border-[#32344d] text-indigo-600 focus:ring-indigo-500 cursor-pointer"
							/>
							<span className="text-slate-800 dark:text-slate-200 font-semibold text-xs">
								Maintain Stock
							</span>
						</label>
					</div>

					{/* 7. Is Fixed Asset (Checkbox) */}
					<div>
						<label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
							<input
								type="checkbox"
								checked={isFixedAsset}
								onChange={(e) => setIsFixedAsset(e.target.checked)}
								className="w-4 h-4 rounded border-slate-300 dark:border-[#32344d] text-indigo-600 focus:ring-indigo-500 cursor-pointer"
							/>
							<span className="text-slate-800 dark:text-slate-200 font-semibold text-xs">
								Is Fixed Asset
							</span>
						</label>
					</div>

					{/* Footer Buttons */}
					<div className="flex items-center justify-between pt-4 border-t border-slate-200/80 dark:border-[#32344d] mt-6">
						<button
							type="button"
							onClick={handleEditFullForm}
							className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-[#282a42] dark:hover:bg-[#32344d] text-slate-700 dark:text-slate-200 rounded-xl font-semibold text-xs transition cursor-pointer"
						>
							Edit Full Form
						</button>

						<button
							type="submit"
							disabled={isSubmitting}
							className="px-6 py-2 bg-slate-900 hover:bg-black dark:bg-[#7367f0] dark:hover:bg-[#685dd8] text-white rounded-xl font-bold text-xs shadow-md transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
						>
							{isSubmitting && <Loader2 size={13} className="animate-spin" />}
							<span>Save</span>
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
