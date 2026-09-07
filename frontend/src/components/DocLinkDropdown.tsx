import { useState, useRef, useEffect, useMemo } from "react";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { Search, ChevronDown, Check, Building2, User, Layers, Scale } from "lucide-react";

interface DocLinkDropdownProps {
	doctype: "Supplier" | "Customer" | "Project" | "Item Group" | "UOM";
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	required?: boolean;
}

export function DocLinkDropdown({
	doctype,
	value,
	onChange,
	placeholder = `Select or search ${doctype}...`,
}: DocLinkDropdownProps) {
	const [isOpen, setIsOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const containerRef = useRef<HTMLDivElement>(null);

	const fieldMap: Record<string, string[]> = {
		Supplier: ["name", "supplier_name", "supplier_group"],
		Customer: ["name", "customer_name", "customer_group"],
		Project: ["name", "project_name"],
		"Item Group": ["name", "item_group_name", "parent_item_group"],
		UOM: ["name", "uom_name"],
	};

	const { data: rawList, isLoading } = useFrappeGetDocList(doctype, {
		fields: fieldMap[doctype] || ["name"],
		orderBy: { field: "name", order: "asc" },
		limit: 0,
	});

	useEffect(() => {
		function handleClickOutside(event: MouseEvent) {
			if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
				setIsOpen(false);
			}
		}
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	const filteredItems = useMemo(() => {
		const list = (rawList || []) as Array<Record<string, any>>;
		if (!searchQuery.trim()) return list;
		const q = searchQuery.toLowerCase();
		return list.filter((it) => {
			const name = String(it.name || "").toLowerCase();
			const title = String(it.supplier_name || it.customer_name || it.project_name || it.item_group_name || it.uom_name || "").toLowerCase();
			const group = String(it.supplier_group || it.customer_group || it.parent_item_group || "").toLowerCase();
			return name.includes(q) || title.includes(q) || group.includes(q);
		});
	}, [rawList, searchQuery]);

	const selectedDoc = useMemo(() => {
		if (!value || !rawList) return null;
		return (rawList as Array<Record<string, any>>).find((it) => it.name === value);
	}, [value, rawList]);

	const handleSelect = (docName: string) => {
		onChange(docName);
		setIsOpen(false);
		setSearchQuery("");
	};

	const Icon = doctype === "Customer" ? User : doctype === "Item Group" ? Layers : doctype === "UOM" ? Scale : Building2;

	const formatSelectedText = () => {
		if (!selectedDoc) return value || placeholder;
		const title = selectedDoc.supplier_name || selectedDoc.customer_name || selectedDoc.project_name || selectedDoc.item_group_name || selectedDoc.uom_name || selectedDoc.name;
		if (title === selectedDoc.name) return selectedDoc.name;
		return `${title} (${selectedDoc.name})`;
	};

	return (
		<div className="relative w-full" ref={containerRef}>
			<div
				onClick={() => setIsOpen(!isOpen)}
				className={`w-full p-2.5 bg-white dark:bg-[#232333] border rounded-xl text-xs flex items-center justify-between cursor-pointer transition ${
					isOpen
						? "border-indigo-600 dark:border-[#7367f0] ring-2 ring-indigo-500/20"
						: "border-slate-200 dark:border-[#32344d] hover:border-indigo-500"
				}`}
			>
				<div className="flex items-center gap-2 overflow-hidden truncate">
					<Icon size={15} className="text-indigo-600 dark:text-[#7367f0] shrink-0" />
					<span
						className={`truncate font-semibold ${
							value
								? "text-slate-900 dark:text-slate-100 font-mono"
								: "text-slate-400 dark:text-[#8f93a7]"
						}`}
					>
						{formatSelectedText()}
					</span>
				</div>
				<ChevronDown size={14} className="text-slate-400 shrink-0 ml-1" />
			</div>

			{isOpen && (
				<div className="absolute left-0 top-full mt-1.5 w-full bg-white dark:bg-[#232333] border border-slate-200 dark:border-[#32344d] rounded-2xl shadow-xl z-50 overflow-hidden text-xs">
					<div className="p-2 border-b border-slate-200 dark:border-[#32344d] flex items-center gap-2 bg-slate-50 dark:bg-[#1e1e2d]">
						<Search size={14} className="text-slate-400 shrink-0" />
						<input
							type="text"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							placeholder={`Search ${doctype} by name or ID...`}
							autoFocus
							className="w-full bg-transparent text-slate-900 dark:text-slate-100 focus:outline-none"
						/>
					</div>

					<div className="max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-[#2d2d3f]">
						{isLoading ? (
							<div className="p-4 text-center text-slate-400">Loading {doctype} records...</div>
						) : filteredItems.length === 0 ? (
							<div className="p-4 text-center text-slate-400">No matching {doctype} records found.</div>
						) : (
							filteredItems.map((it: any) => {
								const isSelected = it.name === value;
								const title = it.supplier_name || it.customer_name || it.project_name || it.item_group_name || it.uom_name || it.name;
								const group = it.supplier_group || it.customer_group || it.parent_item_group;
								return (
									<div
										key={it.name}
										onClick={() => handleSelect(it.name)}
										className={`p-2.5 cursor-pointer transition flex justify-between items-center ${
											isSelected
												? "bg-indigo-50 dark:bg-[#7367f0]/20"
												: "hover:bg-slate-50 dark:hover:bg-[#1e1e2d]"
										}`}
									>
										<div>
											<p className="font-semibold text-slate-900 dark:text-slate-100">
												{title}
											</p>
											<p className="text-[11px] font-mono text-indigo-600 dark:text-[#7367f0]">
												{it.name}
											</p>
										</div>
										<div className="flex items-center gap-2">
											{group && (
												<span className="text-[10px] text-slate-400 border border-slate-200 dark:border-[#32344d] px-1.5 py-0.5 rounded">
													{group}
												</span>
											)}
											{isSelected && <Check size={14} className="text-indigo-600 dark:text-[#7367f0]" />}
										</div>
									</div>
								);
							})
						)}
					</div>
				</div>
			)}
		</div>
	);
}
