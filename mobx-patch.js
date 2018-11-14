/* jshint esversion: 6 */
/* globals mobx */
(function(window, mobx, undefined) {
"use strict";

// UTILITIES FUNCTIONS:

var $mobx = mobx.$mobx,
	
	get = mobx.get,
	set = mobx.set,
	remove = mobx.remove,
	keys = mobx.keys,
	
	// We need to use the same type checks as MobX:
	// Note: mobx.isPlainObject() is split in 2 functions isObject() and isObjectPlain(). (See original: https://github.com/mobxjs/mobx/blob/5.6.0/src/utils/utils.ts#L85)
	isObject = function(value) {
		return typeof value === "object" && value !== null;
	},
	isObjectPlain = function(value) {
		var proto = Object.getPrototypeOf(value);
		return proto === Object.prototype || proto === null;
	},
	isArray = Array.isArray, 	// See: https://github.com/mobxjs/mobx/blob/5.6.0/src/utils/utils.ts#L141
	isMap = function(thing) {	// See: https://github.com/mobxjs/mobx/blob/5.6.0/src/utils/utils.ts#L145
		return thing instanceof Map;
	},
	
	isObservable = mobx.isObservable,
	isObservableObject = mobx.isObservableObject,
	isObservableArray = mobx.isObservableArray,
	isObservableMap = mobx.isObservableMap,
	
	// Used to avoid creating many short lived objects:
	EMPTY_OBJECT = {},
	EMPTY_ARRAY = [],
	EMPTY_MAP = new Map();

// Only needed during development of mobx-patch to catch mistakes:
/*Object.freeze(EMPTY_OBJECT);
Object.freeze(EMPTY_ARRAY);
EMPTY_MAP.set = EMPTY_MAP.delete = EMPTY_MAP.clear = function() {
	throw new Error("Error: Map is not modifiable.");
};/**/


// EXTENDER:

// An extender is a plain object that contains properties.
// The extender is used when creating new observable plain objects, to define its initial properties.
// The properties should only be getters and setters because other properties will be rewritten
// by patch, so that would be wasted work. TODO: should we restrict to getters and setters ?
// 
// Support of $extend is also added to Mobx. As all functions that create new plain object observables
// rely on mobx.observable.object(), we only need to change that function.

var $extend = Symbol("mobx-patch: $extend");

// In createExtender(), we freeze the properties so that they cannot be modified by mistake:
var createExtender = Object.freeze;

var isExtenderOf = function(extender, thing) {
	return isObject(thing) && isObjectPlain(thing) && thing[$mobx][$extend] === extender;
};

// Uncomment in case you need to guard against usage of $extend in mobx.extendObservable():
/*extendObservable = (function(extendObservable) {	// See: https://github.com/mobxjs/mobx/blob/5.6.0/src/api/extendobservable.ts#19
	return function(target, properties, decorators, options) {
		if ($extend in properties) throw new Error("patch.$extend not supported by mobx.extendObservable().");
		return extendObservable(target, properties, decorators, options);
	};
})(mobx.extendObservable);*/

// Adding support for $extend in mobx.observable.object().
// We just wrap the original function in a new custom function:
mobx.observable.object = (function(observable_object) {	// See: https://github.com/mobxjs/mobx/blob/5.6.0/src/api/observable.ts#160
	return function(props, decorators, options) {
		if ($extend in props) {
			var target = mobx.observable.object(props[$extend], undefined, options);
			target[$mobx][$extend] = props[$extend];
			return mobx.extendObservable(target, props, decorators, options);
		}
		else {
			return observable_object(props, decorators, options);
		}
	};
})(mobx.observable.object);


// TYPES COMPARISONS:

// We use integers to compare types and decide compatibility.
// Reason: it's faster than calling isObservableObject(), isPlainObject(), etc.
// multiple times on the same value, and it has good minification.
// Note:
// - "OT_" means ObservableType
// - "T_" means Type (an observable would always be a T_OTHER)
var OT_OTHER = 0,
	OT_OBJECT = 1,
	OT_ARRAY = 2,
	OT_MAP = 3,
	OT_EXTENDEDOBJECT = 4;	// An object that was created form an extender.
var T_OTHER = 0,
	T_PLAINOBJECT = 1,
	T_ARRAY = 2,
	T_MAP = 3,
	T_EXTENDPLAINOBJECT = 4;	// A plain object with the $extend symbol property.
var getValueTypeObservable = function(value) {
	return (isObservableObject(value) && isObjectPlain(value)) ? ($extend in value[$mobx] ? OT_EXTENDEDOBJECT : OT_OBJECT) :
		   isObservableArray(value) ? OT_ARRAY :
		   isObservableMap(value) ? OT_MAP :
		   OT_OTHER;
};
var getValueType = function(value) {
	return isObservable(value) ? T_OTHER :
		   (isObject(value) && isObjectPlain(value)) ? ($extend in value ? T_EXTENDPLAINOBJECT : T_PLAINOBJECT) :
		   isArray(value) ? T_ARRAY :
		   isMap(value) ? T_MAP :
		   T_OTHER;
};
// Check the "compatibility" of oldValue and newValue:
var isCompatibleTypes = function(oldValue_OT, newValue_T, oldValue, newValue) {
	// Ensure newValue is "compatible" with an observable oldValue:
	var compatible = newValue_T === oldValue_OT && newValue_T !== T_OTHER;
	if (compatible && newValue_T === T_EXTENDPLAINOBJECT) {
		// newValue is "compatible" with oldValue only if the extenders are the same:
		return oldValue[$mobx][$extend] === newValue[$extend];
	}
	return compatible;
};


// PATCH FUNCTIONS:

// Conceptually, patch functions work in 4 steps:
// - Try to directly assign the newValue and exit (only if it is not an object, array or Map).
// - Look if we can reuse the observable oldValue. This depends on the "compatibility"
//   of the oldValue and newValue.
// - If not, assign an empty "compatible" plain object/array/Map, or a new extended object
//   from the given $extend symbol property.
// - Recursively remove/add/patch all the own properties.
// The critical point is the assignment of an empty object/array/Map, so that MobX
// won't automatically observe the new children properties before we determine which ones
// can be reused by recursively processing them.
// 
// Implementation notes:
// - we don't need to check if an argument of type observable is actually an observable
//   when it will be processed by MobX later. We just let it fail there.
// - we always delegate to MobX to create the observables, and don't make assumptions
//   about the result. This way, we don't need to worry about decorators and stuff.


// Function responsible to choose if we can reuse the oldValue, or if we need a new empty one.
// oldValue can be: anything.
// newValue can be: null, plain object, observable, array, class object, regexp, browser object, etc.
// The returned value has multiple meanings:
// - return oldValue to reuse it (its properties will be processed).
// - return undefined to use the newValue as is, without processing its properties.
//   (This is good for all unknown/other values)
// - return anything else: it will be processed by the oldValue enhancer (thus probably turned to
//   an observable if not already), and its properties will be processed.
var defaultReplaceValue = function(oldValue_OT, newValue_T, oldValue, newValue) {
	if (isCompatibleTypes(oldValue_OT, newValue_T, oldValue, newValue)) return oldValue;
	else return newValue_T === T_PLAINOBJECT ? EMPTY_OBJECT :
				newValue_T === T_ARRAY ? EMPTY_ARRAY :
				newValue_T === T_MAP ? EMPTY_MAP :
				newValue_T === T_EXTENDPLAINOBJECT ? newValue[$extend] :
				undefined;
};
// Same as defaultReplaceValue(), but converts plain objects to Maps:
var defaultReplaceValueObjToMap = function(oldValue_OT, newValue_T, oldValue, newValue) {
	if (newValue_T === T_PLAINOBJECT) newValue_T = T_MAP;
	return defaultReplaceValue(oldValue_OT, newValue_T, oldValue, newValue);
};


var patchObservable = function(target, newValues, replaceValue) {
	var oldValue_OT = getValueTypeObservable(target);
	var newValue_T = getValueType(newValues);
	
	// Here we can actually accept a Map to define the properties of a plain object or vice versa,
	// because we won't replace the observable.
	// So we temporarily relax the compatibility between plain objects and Maps:
	var _oldValue_OT = oldValue_OT === OT_MAP ? OT_OBJECT : oldValue_OT;
	var _newValue_T = newValue_T === T_MAP ? T_PLAINOBJECT : newValue_T;
	if (!isCompatibleTypes(_oldValue_OT, _newValue_T, target, newValues)) {
		throw new Error("Error: type of newValues not compatible with type of observable.");
		// TODO: would be nice to include the types in the message, but that would be cumbersome...
	}
	
	patchOwnProps(oldValue_OT, newValue_T, target, newValues, replaceValue);
};
var patchObservableProp = function(target, property, newValue, replaceValue) {
	var oldValue = get(target, property);
	
	if (newValue === oldValue) return;
	
	if (typeof newValue !== "object") {	// See: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/typeof#Description
		set(target, property, newValue);
	}
	else {	// newValue type is: null, plain object, observable, array, class object, regexp, browser object, etc.
		
		var oldValue_OT = getValueTypeObservable(oldValue);
		var newValue_T = getValueType(newValue);
		
		var replacement = replaceValue(oldValue_OT, newValue_T, oldValue, newValue);
		
		if (replacement === undefined) {	// For: other/unknown objects, null, observables, etc.
			set(target, property, newValue);
			return;
		}
		else if (replacement !== oldValue) {
			set(target, property, replacement);
			oldValue = get(target, property);
			oldValue_OT = getValueTypeObservable(oldValue);	// Don't assume type, look at the result.
		}
		
		patchOwnProps(oldValue_OT, newValue_T, oldValue, newValue, replaceValue);
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
		
		var replacement = replaceValue(oldValue_OT, newValue_T, oldValue, newValue);
		
		if (replacement === undefined) {	// For: other/unknown objects, null, observables, etc.
			box.set(newValue);
			return;
		}
		else if (replacement !== oldValue) {
			box.set(replacement);
			oldValue = box.get();
			oldValue_OT = getValueTypeObservable(oldValue);	// Don't assume type, look at the result.
		}
		
		patchOwnProps(oldValue_OT, newValue_T, oldValue, newValue, replaceValue);
	}
};
var patchOwnProps = function(oldValue_OT, newValue_T, oldValue, newValue, replaceValue) {
	// - oldValue is an observable plain object, array or Map.
	//   Or an observable object extended with an $extend, in which case it is treated
	//   like a normal observable plain object (There is no risk of removing computed
	//   properties, because they are not enumerable).
	// - newValue is a plain object, array or Map (cannot be an observable). (Note: symbol
	//   properties are not enumerated.)
	// (Note: this function must work even with incompatible types. Compatibility between
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
			if (Object.prototype.hasOwnProperty.call(newValue, key)) {
				patchObservableProp(oldValue, key, newValue[key], replaceValue);
			}
		}
	}
};


// EXPORTING:

// Wraps a custom replaceValue if provided.
// Prepares the replaceValue function so that it will be called with the correct defaultReplaceValue
// as last argument, so that its execution can be controlled by replaceValue.
// (Note: custom replaceValue is used by MobX-computedTree to control more strictly
//        which observable can be reused.)
var wrapReplaceValue = function(replaceValue, _defaultReplaceValue) {
	if (replaceValue === undefined) return _defaultReplaceValue;
	else return function(oldValue_OT, newValue_T, oldValue, newValue) {
		return replaceValue(oldValue_OT, newValue_T, oldValue, newValue, _defaultReplaceValue);
	};
};

window.patch = function(target, newValues, replaceValue) {
	patchObservable(target, newValues, wrapReplaceValue(replaceValue, defaultReplaceValue));
	return target;
};
window.patch.prop = function(target, property, newValue, replaceValue) {
	patchObservableProp(target, property, newValue, wrapReplaceValue(replaceValue, defaultReplaceValue));
	return target;
};
window.patch.boxed = function(box, newValue, replaceValue) {
	patchBoxed(box, newValue, wrapReplaceValue(replaceValue, defaultReplaceValue));
	return box;
};

window.patch.objToMap = function(target, newValues, replaceValue) {
	patchObservable(target, newValues, wrapReplaceValue(replaceValue, defaultReplaceValueObjToMap));
	return target;
};
window.patch.prop.objToMap = function(target, property, newValue, replaceValue) {
	patchObservableProp(target, property, newValue, wrapReplaceValue(replaceValue, defaultReplaceValueObjToMap));
	return target;
};
window.patch.boxed.objToMap = function(box, newValue, replaceValue) {
	patchBoxed(box, newValue, wrapReplaceValue(replaceValue, defaultReplaceValueObjToMap));
	return box;
};

window.patch.extender = createExtender;
window.patch.$extend = $extend;
window.isExtenderOf = isExtenderOf;


window.patch._isCompatibleTypes = isCompatibleTypes;
})(window, mobx);