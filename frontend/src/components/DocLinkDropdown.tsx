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
				className={`w-full p-2.5 bg-[#0E1726] border rounded-xl text-xs flex items-center justify-between cursor-pointer transition ${
					isOpen
						? "border-cyan-400 ring-2 ring-cyan-500/20"
						: "border-slate-700/60 hover:border-cyan-500/60"
				}`}
			>
				<div className="flex items-center gap-2 overflow-hidden truncate">
					<Icon size={15} className="text-cyan-400 shrink-0" />
					<span
						className={`truncate font-semibold ${
							value
								? "text-slate-100 font-mono"
								: "text-slate-400"
						}`}
					>
						{formatSelectedText()}
					</span>
				</div>
				<ChevronDown size={14} className="text-slate-400 shrink-0 ml-1" />
			</div>

			{isOpen && (
				<div className="absolute left-0 top-full mt-1.5 w-full bg-[#111A30] border border-white/[0.08] rounded-2xl shadow-xl shadow-cyan-950/40 z-50 overflow-hidden text-xs backdrop-blur-md">
					<div className="p-2 border-b border-slate-800 flex items-center gap-2 bg-[#0E1726]">
						<Search size={14} className="text-slate-400 shrink-0" />
						<input
							type="text"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							placeholder={`Search ${doctype} by name or ID...`}
							autoFocus
							className="w-full bg-transparent text-slate-100 placeholder-slate-500 focus:outline-none"
						/>
					</div>

					<div className="max-h-56 overflow-y-auto divide-y divide-slate-800/60">
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
												? "bg-cyan-500/15"
												: "hover:bg-cyan-500/5"
										}`}
									>
										<div>
											<p className="font-semibold text-slate-100">
												{title}
											</p>
											<p className="text-[11px] font-mono text-cyan-400">
												{it.name}
											</p>
										</div>
										<div className="flex items-center gap-2">
											{group && (
												<span className="text-[10px] text-slate-400 border border-slate-700/60 px-1.5 py-0.5 rounded">
													{group}
												</span>
											)}
											{isSelected && <Check size={14} className="text-cyan-400" />}
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
