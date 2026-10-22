"use client";

import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { ConsoleSelect } from "~/app/_components/console-select";

/** Pagination covers only the records returned by the existing query. */
export function usePagination<T>(items: T[], pageSize = 8) {
	const [requestedPage, setPage] = useState(1);
	const pages = Math.max(1, Math.ceil(items.length / pageSize));
	const page = Math.min(requestedPage, pages);
	return {
		items: items.slice((page - 1) * pageSize, page * pageSize),
		page,
		pages,
		pageSize,
		total: items.length,
		setPage,
	};
}

export function SearchField({
	label,
	placeholder,
	value,
	onChange,
}: {
	label: string;
	placeholder: string;
	value: string;
	onChange: (value: string) => void;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	return (
		<div className="search">
			<Search aria-hidden="true" size={16} />
			<input
				aria-label={label}
				autoComplete="off"
				onChange={(event) => onChange(event.target.value)}
				placeholder={placeholder}
				ref={inputRef}
				type="search"
				value={value}
			/>
			{value && (
				<button
					aria-label={`清空${label}`}
					className="search-clear"
					onClick={() => {
						onChange("");
						inputRef.current?.focus();
					}}
					type="button"
				>
					<X size={15} />
				</button>
			)}
		</div>
	);
}

export function FilterField({
	id,
	label,
	value,
	onChange,
	options,
}: {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	options: { value: string; label: string }[];
}) {
	return (
		<div className="filter-field">
			<label className="sr-only" htmlFor={id}>
				{label}
			</label>
			<ConsoleSelect
				id={id}
				onValueChange={onChange}
				options={options}
				value={value}
			/>
		</div>
	);
}

export function CollectionToolbar({ children }: { children: ReactNode }) {
	return <div className="collection-toolbar">{children}</div>;
}

export function Pagination({
	page,
	pages,
	pageSize,
	total,
	onChange,
	label,
}: {
	page: number;
	pages: number;
	pageSize: number;
	total: number;
	onChange: (page: number) => void;
	label: string;
}) {
	return (
		<nav aria-label={`${label}分页`} className="pagination">
			<output aria-live="polite">
				{total
					? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} / ${total} 条`
					: "0 条记录"}
			</output>
			<div>
				<button
					aria-label={`${label}上一页`}
					className="icon-button"
					disabled={page <= 1}
					onClick={() => onChange(page - 1)}
					type="button"
				>
					<ChevronLeft size={16} />
				</button>
				<span>
					第 {page} / {pages} 页
				</span>
				<button
					aria-label={`${label}下一页`}
					className="icon-button"
					disabled={page >= pages}
					onClick={() => onChange(page + 1)}
					type="button"
				>
					<ChevronRight size={16} />
				</button>
			</div>
		</nav>
	);
}
