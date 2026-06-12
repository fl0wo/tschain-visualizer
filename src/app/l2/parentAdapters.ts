import type { ParentL1 } from '../../core/layers/Layer2System';
import type { ChainModel } from '../model/ChainModel';

/**
 * Thin facades adapting the running L1 models to the ParentL1 contract
 * the Layer-2 core speaks — the L2 never holds an app model directly.
 * (posParent for the Base rollup arrives with that milestone's commit.)
 */
export function powParent(model: ChainModel): ParentL1 {
	return {
		events: model.events,
		submitSettlement: (request) =>
			model.submitSigned(request.from, request.to, request.amount, {
				kind: request.kind,
				memo: request.memo,
			}),
		getConfirmations: (txHash) => model.getConfirmations(txHash),
		getBalance: (address) => model.getBalance(address),
		getTransactionMemo: (txHash) => model.getTransactionMemo(txHash),
	};
}
