import { useState, useRef, useEffect } from "react";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { Search, ChevronDown, Package, Plus } from "lucide-react";
import { QuickAddItemModal } from "./QuickAddItemModal";

interface ItemLinkDropdownProps {
	value: string;
	onChange: (item: { item_code: string; description: string; uom: string }) => void;
	placeholder?: string;
}

export function ItemLinkDropdown({ value, onChange, placeholder = "Select or search ERPNext Item..." }: ItemLinkDropdownProps) {
	const [isOpen, setIsOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);

	const { data: itemsList, isLoading, mutate } = useFrappeGetDocList("Item", {
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

	const handleItemCreated = (newItem: {
		item_code: string;
		item_name: string;
		stock_uom: string;
		item_group: string;
	}) => {
		onChange({
			item_code: newItem.item_code,
			description: newItem.item_name || newItem.item_code,
			uom: newItem.stock_uom || "Nos",
		});
		if (mutate) {
			mutate();
		}
		setIsOpen(false);
		setSearchQuery("");
		setIsQuickAddOpen(false);
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
							<div className="p-4 text-center space-y-2">
								<p className="text-slate-400">
									{searchQuery ? `No matching items found for "${searchQuery}".` : "No matching items found."}
								</p>
								<button
									type="button"
									onClick={(e) => {
										e.stopPropagation();
										setIsQuickAddOpen(true);
									}}
									className="px-3 py-1.5 bg-indigo-600 dark:bg-[#7367f0] hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1 shadow-sm transition cursor-pointer"
								>
									<Plus size={13} />
									<span>+ Create Item {searchQuery ? `"${searchQuery}"` : ""}</span>
								</button>
							</div>
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

					{/* Bottom Action: + Create New Item (always visible for instant access) */}
					<div className="p-2 border-t border-slate-200 dark:border-[#32344d] bg-slate-50/70 dark:bg-[#1e1e2d]">
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								setIsQuickAddOpen(true);
							}}
							className="w-full py-2 px-3 bg-indigo-50 hover:bg-indigo-100 dark:bg-[#7367f0]/15 dark:hover:bg-[#7367f0]/25 text-indigo-600 dark:text-[#7367f0] border border-indigo-200 dark:border-[#7367f0]/30 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
						>
							<Plus size={14} />
							<span>+ Create New Item</span>
						</button>
					</div>
				</div>
			)}

			{/* Quick Add Item Modal */}
			<QuickAddItemModal
				isOpen={isQuickAddOpen}
				onClose={() => setIsQuickAddOpen(false)}
				onSuccess={handleItemCreated}
				initialItemCode={searchQuery}
			/>
		</div>
	);
}

