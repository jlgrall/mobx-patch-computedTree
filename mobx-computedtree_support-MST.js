/* globals mobxStateTree, computedTree */
(function(MST, extendFromComputedTreeSymbols) {
"use strict";


// Add support for computedTree.$computedTree to mobx-state-tree (https://github.com/mobxjs/mobx-state-tree)
if (MST) {
	var ModelTypeProto = MST.types.model().constructor.prototype;
	ModelTypeProto.instantiateViews = (function(instantiateViews) {
		return function(self, views) {
			// See: https://github.com/mobxjs/mobx-state-tree/blob/v3.7.1/packages/mobx-state-tree/src/types/complex-types/model.ts#453
			instantiateViews(self, views);
			extendFromComputedTreeSymbols(self, views);
		};
	})(ModelTypeProto.instantiateViews);
}

})(mobxStateTree, computedTree._extendFromComputedTreeSymbols);