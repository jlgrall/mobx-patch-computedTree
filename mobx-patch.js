/* jshint esversion: 6 */
/* globals mobx */
(function(window, mobx, undefined) {
"use strict";

// UTILITIES FUNCTIONS:

var hasOwn = function(obj, key) {
		return Object.prototype.hasOwnProperty.call(obj, key);
	},
	
	// We need to use the same checks as MobX:
	isPlainObject = function(value) {	// See: https://github.com/mobxjs/mobx/blob/master/src/utils/utils.ts#L85
		if (value === null || typeof value !== "object") return false;
		var proto = Object.getPrototypeOf(value);
		return proto === Object.prototype || proto === null;
	},
	isArray = Array.isArray, // See: https://github.com/mobxjs/mobx/blob/master/src/utils/utils.ts#L141
	isMap = function(thing) {	// See: https://github.com/mobxjs/mobx/blob/master/src/utils/utils.ts#L145
		return thing instanceof Map;
	},
	
	//has = mobx.has,
	get = mobx.get,
	set = mobx.set,
	remove = mobx.remove,
	keys = mobx.keys,
	
	//isObservable = mobx.isObservable,
	isObservableObject = mobx.isObservableObject,
	isObservableArray = mobx.isObservableArray,
	isObservableMap = mobx.isObservableMap,
	
	// Used to avoid creating many short lived objects:
	EMPTY_OBJECT = Object.freeze({}),
	EMPTY_ARRAY = Object.freeze([]),
	EMPTY_MAP = new Map();

// Is this necessary ? Prevents development mistakes.
// (Could it make the Map slower even if those methods are never used ?)
EMPTY_MAP.set = EMPTY_MAP.delete = EMPTY_MAP.clear = function() {
	throw new Error("Error: Map is not modifiable.");
};


// TYPES COMPARISONS:

// Optimization: using integers to compare types and decide compatibility.
// (It's better than calling isObservableObject(), isPlainObject(), etc. multiple times on the same value, and it has good minification)
// Note:
// - "OT_" means ObservableType
// - "T_" means Type (so an observable would be a T_OTHER)
var OT_OTHER = 0,
	OT_OBJECT = 1,
	OT_ARRAY = 2,
	OT_MAP = 3;
var T_OTHER = 0,
	T_PLAINOBJECT = 1,
	T_ARRAY = 2,
	T_MAP = 3;
var getValueTypeObservable = function(value) {
	return isObservableObject(value) ? OT_OBJECT :
		   isObservableArray(value) ? OT_ARRAY :
		   isObservableMap(value) ? OT_MAP :
		   OT_OTHER;
};
var getValueType = function(value) {
	return isPlainObject(value) ? T_PLAINOBJECT :
		   isArray(value) ? T_ARRAY :
		   isMap(value) ? T_MAP :
		   T_OTHER;
};
// Check the "compatibility" of oldValue and newValue:
var isCompatibleTypes = function(oldValue_OT, newValue_T) {
	// Ensure newValue is "compatible" with an observable oldValue:
	return newValue_T === oldValue_OT && oldValue_OT !== OT_OTHER;
};


// PATCH FUNCTIONS:

// Conceptually, patch functions work in 4 steps:
// - Try to directly assign the newValue and exit (only if it is not a plain object, array or Map).
// - Look if we can reuse the observable oldValue. This depends on the "compatibility"
//   of the oldValue and newValue.
// - If not, assign an empty "compatible" plain object/array/Map.
// - Recursively remove/assign all the own properties.
// The critical point is the assignment of an empty plain object/array/Map, so that MobX
// won't automatically observe the children properties before we can recursively process them.
// 
// Implementation notes:
// - we don't need to check if an argument of type observable is actually an observable
//   when it will be processed by MobX later. We just let it fail there.
// - we always delegate to MobX to create the observables, and don't make assumptions
//   about the result. This way, we don't need to worry about decorators and stuff.


// Function responsible to choose if we can reuse the oldValue, or if we need a new empty one.
// oldValue is an observable.
// newValue can be: null, plain object, observable, array, class object, regexp, browser object, etc.
// The object returned will be used:
// - return oldValue to reuse it.
// - return an empty plain object/array/Map to make it observable and to continue processing its properties.
// - return undefined for unknown/other values. The newValue will be assigned as is, without being processed further.
var defaultReplaceValue = function(oldValue, newValue, oldValue_OT, newValue_T) {
	if (isCompatibleTypes(oldValue_OT, newValue_T)) return oldValue;
	else return newValue_T === T_PLAINOBJECT ? EMPTY_OBJECT :
				newValue_T === T_ARRAY ? EMPTY_ARRAY :
				newValue_T === T_MAP ? EMPTY_MAP :
				undefined;
};
// Same as defaultReplaceValue(), but converts plain objects to Maps:
var defaultReplaceValueObjToMap = function(oldValue, newValue, oldValue_OT, newValue_T) {
	if(newValue_T === T_PLAINOBJECT && oldValue_OT === OT_MAP) return EMPTY_MAP;
	else return defaultReplaceValue(oldValue, newValue, oldValue_OT, newValue_T);
};


var patchObservable = function(observable, newValues, replaceValue) {
	var oldValue_OT = getValueTypeObservable(observable);
	var newValue_T = getValueType(newValues);
	
	// Here we can relax the compatibility between PlainObjects and Maps:
	var _oldValue_OT = oldValue_OT === OT_MAP ? OT_OBJECT : oldValue_OT;
	var _newValue_T = newValue_T === T_MAP ? T_PLAINOBJECT : newValue_T;
	if (!isCompatibleTypes(_oldValue_OT, _newValue_T)) {
		throw new Error("Error: type of newValues not compatible with type of observable.");
		// TODO: would be nice to include the types in the message, but that would be cumbersome...
	}
	
	patchOwnProps(observable, newValues, oldValue_OT, newValue_T, replaceValue);
};
var patchObservableProp = function(observable, property, newValue, replaceValue) {
	var oldValue = get(observable, property);

	if (newValue === oldValue) return;
	
	if (typeof newValue !== "object") {	// See: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/typeof#Description
		set(observable, property, newValue);
	}
	else {	// newValue type is: null, plain object, observable, array, class object, regexp, browser object, etc.
		
		var oldValue_OT = getValueTypeObservable(oldValue);
		var newValue_T = getValueType(newValue);
		
		var replacement = replaceValue(oldValue, newValue, oldValue_OT, newValue_T);
		
		if (replacement !== oldValue) {
			if (replacement === undefined) {	// For: other/unknown objects, null, observables, etc.
				set(observable, property, newValue);
				return;
			}
			
			set(observable, property, replacement);
			oldValue = get(observable, property);
			oldValue_OT = getValueTypeObservable(oldValue);	// Don't assume type, look at the result.
		}
		
		patchOwnProps(oldValue, newValue, oldValue_OT, newValue_T, replaceValue);
	}
};
var patchBoxed = function(box, newValue, replaceValue) {
	var oldValue = box.get();

	if (newValue === oldValue) return;
	
	if (typeof newValue !== "object") {	// See: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/typeof#Description
		box.set(newValue);
	}
	else {	// newValue type is: null, plain object, observable, array, class object, regexp, browser object, etc.
		
		var newValue_T = getValueType(newValue);
		var oldValue_OT = getValueTypeObservable(oldValue);
		
		var replacement = replaceValue(oldValue, newValue, oldValue_OT, newValue_T);
		
		if (replacement !== oldValue) {
			if (replacement === undefined) {	// For: other/unknown objects, null, observables, etc.
				box.set(newValue);
				return;
			}
			
			box.set(replacement);
			oldValue = box.get();
			oldValue_OT = getValueTypeObservable(oldValue);	// Don't assume type, look at the result.
		}
		
		patchOwnProps(oldValue, newValue, oldValue_OT, newValue_T, replaceValue);
	}
};
var patchOwnProps = function(oldValue, newValue, oldValue_OT, newValue_T, replaceValue) {
	// - oldValue is an observable plain object, array or Map
	// - newValue is a plain object, array or Map (cannot be an observable)
	// (Note: this function can work even with incompatible types. Compatibility between
	//        oldValue and newValue is checked elsewhere.)
	
	var key, value;
	
	// Remove unused keys:
	if (oldValue_OT === OT_ARRAY && newValue_T === T_ARRAY) {
		// Shortcut for arrays:
		if (oldValue.length > newValue.length) oldValue.length = newValue.length;
	}
	else {
		if (newValue_T === T_MAP) {
			for(key of keys(oldValue)) {
				if (!(newValue.has(key))) remove(oldValue, key);
			}
		}
		else {
			for(key of keys(oldValue)) {
				if (!(key in newValue)) remove(oldValue, key);
			}
		}
	}
	
	// Add or update new keys:
	if (newValue_T === T_MAP) {
		for([key, value] of newValue) {
			patchObservableProp(oldValue, key, value, replaceValue);
		}
	}
	else {
		for(key in newValue) {
			if (hasOwn(newValue, key)) {
				patchObservableProp(oldValue, key, newValue[key], replaceValue);
			}
		}
	}
};


// EXPORTING:

// Wraps a custom replaceValue if provided.
// Prepares the replaceValue function so that it will be called with the correct defaultReplaceValue
// as last argument, so that it's execution can be controlled by replaceValue.
// (Note: custom replaceValue is used by MobX-computedTree to control more strictly
//        which observable can be reused.)
var wrapReplaceValue = function(replaceValue, _defaultReplaceValue) {
	if (replaceValue === undefined) return _defaultReplaceValue;
	else return function(oldValue, newValue, oldValue_OT, newValue_T) {
		return replaceValue(oldValue, newValue, oldValue_OT, newValue_T, _defaultReplaceValue);
	};
};

window.patch = function(observable, newValues, replaceValue) {
	patchObservable(observable, newValues, wrapReplaceValue(replaceValue, defaultReplaceValue));
};
window.patch.prop = function(observable, property, newValue, replaceValue) {
	patchObservableProp(observable, property, newValue, wrapReplaceValue(replaceValue, defaultReplaceValue));
};
window.patch.boxed = function(box, newValue, replaceValue) {
	patchBoxed(box, newValue, wrapReplaceValue(replaceValue, defaultReplaceValue));
};

window.patch.objToMap = function(observable, newValues, replaceValue) {
	patchObservable(observable, newValues, wrapReplaceValue(replaceValue, defaultReplaceValueObjToMap));
};
window.patch.prop.objToMap = function(observable, property, newValue, replaceValue) {
	patchObservableProp(observable, property, newValue, wrapReplaceValue(replaceValue, defaultReplaceValueObjToMap));
};
window.patch.boxed.objToMap = function(box, newValue, replaceValue) {
	patchBoxed(box, newValue, wrapReplaceValue(replaceValue, defaultReplaceValueObjToMap));
};


window.patch._isCompatibleTypes = isCompatibleTypes;
})(window, mobx);