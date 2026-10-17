"use client";

import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp, type LucideIcon } from "lucide-react";
import { useState } from "react";

type SelectOption = {
	value: string;
	label: string;
	description?: string;
	icon?: LucideIcon;
};

export function ConsoleSelect({
	id,
	name,
	value,
	onValueChange,
	options,
	placeholder = "请选择",
	disabled = false,
	required = false,
}: {
	id: string;
	name?: string;
	value: string;
	onValueChange: (value: string) => void;
	options: SelectOption[];
	placeholder?: string;
	disabled?: boolean;
	required?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
	const SelectedIcon = options.find((option) => option.value === value)?.icon;

	return (
		<Select.Root
			disabled={disabled || options.length === 0}
			name={name}
			onOpenChange={setOpen}
			onValueChange={onValueChange}
			open={open}
			required={required}
			value={value}
		>
			<Select.Trigger className="select-trigger" id={id} ref={setTrigger}>
				{SelectedIcon && (
					<span aria-hidden="true" className="select-option-icon">
						<SelectedIcon size={16} />
					</span>
				)}
				<span className="select-value">
					<Select.Value placeholder={placeholder} />
				</span>
				<Select.Icon className="select-chevron">
					<ChevronDown size={16} />
				</Select.Icon>
			</Select.Trigger>
			{trigger && (
				// Keep the menu inside the native dialog's top layer when used in a modal.
				<Select.Portal container={trigger.closest("dialog") ?? undefined}>
					<Select.Content
						className="select-content"
						collisionPadding={12}
						onEscapeKeyDown={(event) => {
							event.preventDefault();
							event.stopPropagation();
							setOpen(false);
						}}
						position="popper"
						sideOffset={7}
					>
						<Select.ScrollUpButton className="select-scroll">
							<ChevronUp size={15} />
						</Select.ScrollUpButton>
						<Select.Viewport className="select-viewport">
							{options.map(
								({ value: optionValue, label, description, icon: Icon }) => (
									<Select.Item
										className="select-option"
										key={optionValue}
										textValue={label}
										value={optionValue}
									>
										{Icon && (
											<span aria-hidden="true" className="select-option-icon">
												<Icon size={17} />
											</span>
										)}
										<span className="select-option-copy">
											<Select.ItemText>{label}</Select.ItemText>
											{description && (
												<span className="select-description">
													{description}
												</span>
											)}
										</span>
										<Select.ItemIndicator className="select-check">
											<Check size={16} strokeWidth={2.5} />
										</Select.ItemIndicator>
									</Select.Item>
								),
							)}
						</Select.Viewport>
						<Select.ScrollDownButton className="select-scroll">
							<ChevronDown size={15} />
						</Select.ScrollDownButton>
					</Select.Content>
				</Select.Portal>
			)}
		</Select.Root>
	);
}
