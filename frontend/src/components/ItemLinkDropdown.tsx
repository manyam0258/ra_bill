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
				className={`w-full p-2 bg-[#0E1726] border rounded-xl text-xs flex items-center justify-between cursor-pointer transition ${
					isOpen
						? "border-cyan-400 ring-2 ring-cyan-500/20"
						: "border-slate-700/60 hover:border-cyan-500/60"
				}`}
			>
				<div className="flex items-center gap-2 overflow-hidden truncate">
					<Package size={14} className="text-cyan-400 shrink-0" />
					<span className="font-mono font-bold text-slate-100 truncate">
						{value || placeholder}
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
							placeholder="Search item code, group, description..."
							autoFocus
							className="w-full bg-transparent text-slate-100 placeholder-slate-500 focus:outline-none"
						/>
					</div>

					<div className="max-h-56 overflow-y-auto divide-y divide-slate-800/60">
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
									className="px-3 py-1.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1 shadow-sm transition cursor-pointer"
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
									className="p-2.5 hover:bg-cyan-500/10 cursor-pointer transition flex justify-between items-center"
								>
									<div>
										<p className="font-mono font-bold text-cyan-400">{it.name}</p>
										<p className="text-[11px] text-slate-300 line-clamp-1">{it.item_name || it.description}</p>
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
					<div className="p-2 border-t border-slate-800 bg-[#0E1726]">
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								setIsQuickAddOpen(true);
							}}
							className="w-full py-2 px-3 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
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

