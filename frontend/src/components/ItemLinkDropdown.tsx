import React, { useState, useRef, useEffect } from "react";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { Search, ChevronDown, Package } from "lucide-react";

interface ItemLinkDropdownProps {
	value: string;
	onChange: (item: { item_code: string; description: string; uom: string }) => void;
	placeholder?: string;
}

export function ItemLinkDropdown({ value, onChange, placeholder = "Select or search ERPNext Item..." }: ItemLinkDropdownProps) {
	const [isOpen, setIsOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const containerRef = useRef<HTMLDivElement>(null);

	const { data: itemsList, isLoading } = useFrappeGetDocList("Item", {
		fields: ["name", "item_name", "item_group", "description", "stock_uom"],
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

	const filteredItems = (itemsList || []).filter((it: any) => {
		const q = searchQuery.toLowerCase();
		return (
			(it.name && it.name.toLowerCase().includes(q)) ||
			(it.item_name && it.item_name.toLowerCase().includes(q)) ||
			(it.item_group && it.item_group.toLowerCase().includes(q)) ||
			(it.description && it.description.toLowerCase().includes(q))
		);
	});

	const handleSelectItem = (it: any) => {
		onChange({
			item_code: it.name,
			description: it.description || it.item_name || it.name,
			uom: it.stock_uom || "Nos",
		});
		setIsOpen(false);
		setSearchQuery("");
	};

	return (
		<div className="relative w-full" ref={containerRef}>
			<div
				onClick={() => setIsOpen(!isOpen)}
				className="w-full p-2 bg-slate-50 dark:bg-[#1e1e2d] border border-slate-200 dark:border-[#32344d] rounded-xl text-xs flex items-center justify-between cursor-pointer hover:border-indigo-500 transition"
			>
				<div className="flex items-center gap-2 overflow-hidden truncate">
					<Package size={14} className="text-indigo-600 dark:text-[#7367f0] shrink-0" />
					<span className="font-mono font-bold text-slate-900 dark:text-slate-100 truncate">
						{value || placeholder}
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
							placeholder="Search item code, group, description..."
							autoFocus
							className="w-full bg-transparent text-slate-900 dark:text-slate-100 focus:outline-none"
						/>
					</div>

					<div className="max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-[#2d2d3f]">
						{isLoading ? (
							<div className="p-4 text-center text-slate-400">Loading items...</div>
						) : filteredItems.length === 0 ? (
							<div className="p-4 text-center text-slate-400">No matching items found.</div>
						) : (
							filteredItems.map((it: any) => (
								<div
									key={it.name}
									onClick={() => handleSelectItem(it)}
									className="p-2.5 hover:bg-indigo-50 dark:hover:bg-[#7367f0]/15 cursor-pointer transition flex justify-between items-center"
								>
									<div>
										<p className="font-mono font-bold text-indigo-600 dark:text-[#7367f0]">{it.name}</p>
										<p className="text-[11px] text-slate-600 dark:text-slate-300 line-clamp-1">{it.item_name || it.description}</p>
									</div>
									<div className="text-right text-[10px] text-slate-400 shrink-0 ml-2">
										<span className="font-semibold block">{it.item_group || "Item"}</span>
										<span className="font-mono">{it.stock_uom || "Nos"}</span>
									</div>
								</div>
							))
						)}
					</div>
				</div>
			)}
		</div>
	);
}
