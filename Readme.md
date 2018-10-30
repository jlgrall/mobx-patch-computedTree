# MobX-patch & MobX-computedTree

Update and manage trees of observables. Working on top of [MobX](https://mobx.js.org/) ([GitHub page](https://github.com/mobxjs/mobx)).

Two components: **`patch`** and **`computedTree`**.

**`patch`** updates an observable data structure in an efficient way:
```javascript
var state = observable({
	firstName: "John",
	sleeping: true,
	ranges: {low: [0, 2], high: [7, 9]}
});
patch(state, {
	firstName: "John",
	lastName: "Smith",
	ranges: {low: [0, 2], mid: [3, 6] high: [7, 999]}
});
```

**`computedTree`** is a computed value that is suited for computing trees of observable objects, arrays and Maps:

```javascript
var weather = mobx.observable({
	records: [{T: 7}, {T: 3}, {T: -2}, {T: -5}, {T: -1}, {T: 3}, {T: -1}],
	get sorted() {
		var pos = [], neg = [], min = this.records[0].T;
		this.records.forEach(record => {
			if(record.T < 0) pos.push(record.T);
			else neg.push(record.T);
			if (record.T < min) min = record.T;
		});
		return {pos: pos, neg: neg, min: min};
	}
}, {sorted: computedTree});
mobx.autorun(() => {
	console.log(weather.sorted.neg.length + " days of negative temperatures");
	console.log("Min = " + weather.sorted.min + "°");
});
```

**MobX compatibility:** MobX 5 (Tested with MobX 5.5. No idea about MobX 4)

**Browser compatibility:** any browser that [supports MobX 5](https://github.com/mobxjs/mobx#browser-support).
_(ES6 features used: [for..of](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for...of) and [destructuring assignment](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Destructuring_assignment))_

**Alternatives:**

- [Implementing an observable.array.patch ?](https://github.com/mobxjs/mobx/issues/1590#issuecomment-396860790)
- [mobx-state-tree (MST)](https://github.com/mobxjs/mobx-state-tree)


## MobX-patch

**`patch`** updates an observable data structure in an efficient way. It tries to reuse previous observable values to reduce the number of modified observables in the data structure. This is better than replacing observable structures every time something changes and it helps to reduce the number of unnecessary mutation notifications, which reduces the number of dependent recomputations to only those that depend on a modified value in your data structure.

With `patch` you no longer need to use the [`comparer.structural`](https://mobx.js.org/refguide/computed-decorator.html#built-in-comparers) for your computed data structures, because unmodified values are reused, which makes the default comparer, with its strict equality comparison, ideal and faster than the structural one.

_Note: always use `patch` in an [action](https://mobx.js.org/refguide/action.html), so that the changes will be efficiently applied in a batch._

```javascript
var state = observable({
	colors: ["violet", "green"],
	sizes: {T: "Tiny", S: "Small", M: "MEDIUM"},
	msg: [{greet: "Hello", who: "world"}]
	lastUpdate: "yesterday"
});
var oldColors = state.colors;

patch(state, {
	colors: ["red", "green", "blue"],
	sizes: {S: "Small", M: "Medium", L:"Large"},
	msg: {txt: ["Hello", "world"]}
	nb: new Map([2, "two"], [4, "four"]),
});
// Now:
// state.colors === oldColors  (Reusing the old observable array)
// state.colors[0] === "red"  (Changed)
// state.colors[1] === "green"  (Reused)
// state.colors[2] === "black"  (Added)
// state.sizes.T === undefined  (Removed)
// state.sizes.S === "Small"  (Reused)
// state.sizes.M === "Medium"  (Changed)
// state.msg  (Changed to an observable plain object)
// state.msg.txt[0] === "Hello"  (Added)
// state.cities.get(4) === "four"  (Added)
// state.lastUpdate === undefined  (Removed)

patch.prop(state, "msg", undefined);
// Now:
// state.msg === undefined  (Changed: the property "msg" is still present with a value of undefined)
// state.colors === oldColors  (untouched)
```

### Behavior:

When patching, we make sure to get the same result as if you had directly assigned the values to the patched observable data structure. For instance, the patched object's own [decorator](https://mobx.js.org/refguide/modifiers.html) is executed as it should on the new values, as expected from the MobX.

Only plain objects, arrays and [ES6 Maps](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map) get a special treatment. If there is already an observable value of the same type (plain object, array or Map), it is reused instead of replacing it with the new value.

### API

#### patch(observable, newValues)

`observable`: an observable of type plain object, array or Map. The target that will be patched.  
`newValues`: a plain object, array or Map. Contains the properties that will be assigned to the target.  

```javascript
var stateObj = observable({key: "val"});
patch(stateObj, {key: "val", newKey, "newVal"});
var stateArr = observable(["zero"]);
patch(stateArr, ["zero", "one"]);
```

_Note: to convert all plain objects to Maps, use: `patch.objToMap(...)` instead._

#### patch.prop(observable, property, newValue)

`observable`: an observable of type plain object, array or Map.  
`property`: the property that will be patched.  
`newValue`: anything. The new value that will be assigned to the property of the observable.  

```javascript
var stateObj = observable({key: "val"});
patch.prop(stateObj, "newKey", "newVal");
var stateArr = observable(["zero"]);
patch.prop(stateArr, 1, "one");
```

_Note: to convert all plain objects to Maps, use: `patch.prop.objToMap(...)` instead._

#### patch.boxed(box, newValue)

`box`: an [observable box](https://mobx.js.org/refguide/boxed.html) (also called boxed value).  
`newValue`: anything. The new value that will be assigned to observable box.  

```javascript
var stateObj = observable({key: "val"});
patch.boxed(stateObj, {key: "val", newKey, "newVal"});
var stateArr = observable(["zero"]);
patch.boxed(stateArr, ["zero", "one"]);
```

_Note: to convert all plain objects to Maps, use: `patch.boxed.objToMap(...)` instead._


## MobX-computedTree

_Requires MobX-patch._

**`computedTree`** is a computed value that is suited for computing trees of observable objects, arrays and Maps. Using the `patch` function, it recursively turns each plain object, array and [ES6 Maps](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map) into observables, and efficiently updates the resulting tree in a batch during a recomputation.

The generated observables of the tree are protected from modifications. And when the `computedTree` is not observed, it is automatically suspended and garbage collected like a computed value.

Because a `computedTree` is a `computed`, you can use the [computed API](https://mobx.js.org/refguide/computed-decorator.html) on it like `observe`, `keepAlive`, `isComputedProp`, etc.

Advantages over a simple computed:
- protection against modifications of the generated tree
- efficient update of tree during recomputation, reducing number of mutations
- reduced number of dependent recomputations

```javascript
var store = observable({
	products: new Map([
		[1, {id: 1, name: "Paper", price: 1, stock: 50}],
		[2, {id: 2, name: "Pen", price: 5, stock: 25}],
		[3, {id: 3, name: "Notebook", price: 12, stock: 8}],
		[4, {id: 4, name: "Calendar", price: 30, stock: 40}],
		[5, {id: 5, name: "Backpack", price: 40, stock: 2}],
	]),
	get lowStock() {
		return Array.from(this.products, ([id, product]) => product).filter(product => product.stock < 10);
	},
	get byPriceRange() {
		var low = new Map(), mid = new Map(), high = new Map();
		this.products.forEach(product => {
			if(product.price < 10) low.set(product.id, product);
			else if(product.price < 20) mid.set(product.id, product);
			else high.set(product.id, product);
		});
		return {low: low, mid: mid, high: high};
	},
}, {lowStock: computedTree, byPriceRange: computedTree});

autorun(() => console.log("lowStock:", store.lowStock.map(p => p.name)));
autorun(() => console.log("Low price:", Array.from(store.byPriceRange.low, kv => kv[1].name)));
autorun(() => console.log("Mid price:", Array.from(store.byPriceRange.mid, kv => kv[1].name)));
autorun(() => console.log("High price:", Array.from(store.byPriceRange.high, kv => kv[1].name)));

console.log("Action: emptying stock of Pens...");
runInAction(() => store.products.get(2).stock = 0);
console.log('=> Only the "lowStock" autorun has been re-executed.');

console.log('Action: changing price range of Pens from "low" to "high"...');
runInAction(() => store.products.get(2).price = 999);
console.log('=> Only the "Low price" and "High price" autoruns have been re-executed.');
```

### API

#### (@)computedTree

Decorator which creates a computedTree property.

_Note: to automatically convert all plain objects to Maps, use: `computedTree.objToMap` instead._


#### computedTree.isComputedTreeProp(thing, property)

Returns true if the designated property is a computedTree value.

```javascript
var store = mobx.observable({
	get greeting() {
		return "hello";
	}
}, {greeting: computedTree});
computedTree.isComputedTreeProp(store, "greeting")	// => true
```