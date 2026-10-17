import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "~/server/api/root";
import { previewSnapshot } from "~/shared/ui-preview";

export const previewLink: TRPCLink<AppRouter> =
	() =>
	({ op }) =>
		observable((observer) => {
			if (op.type === "query" && op.path === "mon2api.snapshot") {
				observer.next({ result: { data: previewSnapshot } });
				observer.complete();
			} else {
				observer.error(new TRPCClientError("UI 预览模式不执行后端操作。"));
			}
		});
