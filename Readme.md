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
			if(record.T < 0) neg.push(record.T);
			else pos.push(record.T);
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

**Sizes:**  
- MobX-patch: ~1 kB minified & gzipped.
- MobX-computedTree: ~1.3 kB minified & gzipped.

**Alternatives:**

- [Implementing an observable.array.patch ?](https://github.com/mobxjs/mobx/issues/1590#issuecomment-396860790)
- [mobx-state-tree (MST)](https://github.com/mobxjs/mobx-state-tree)


## Compatibility
**MobX compatibility:**  
Should work with MobX 4.5+ and 5.5+ (No idea about older versions)  
Only tested with MobX 5.5


**Browser support:**  
Any browser that [supports MobX 5](https://github.com/mobxjs/mobx#browser-support). (Not Edge 12 nor Node 5.)  
Lit of ES6 features used:
- [for..of](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for...of) and [destructuring assignment](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Destructuring_assignment) (can be transpiled to ES5)
- [ES6 Maps](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map) and [ES6 Symbols](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol)


## MobX-patch

**`patch`** updates an observable data structure in an efficient way. It tries to reuse previous observable values to reduce the number of modified observables in the data structure. This is better than replacing observable structures every time something changes and it helps to reduce the number of unnecessary mutation notifications, which reduces the number of dependent recomputations to only those that depend on a modified value in your data structure.

With `patch` you no longer need to use the [`comparer.structural`](https://mobx.js.org/refguide/computed-decorator.html#built-in-comparers) for your computed data structures, because unmodified values are reused, which makes the default comparer, with its strict equality comparison, ideal and faster than the structural one.

_Note: `patch` doesn't support cyclic references._  
_Note: unlike in the following examples, always use `patch` in an [action](https://mobx.js.org/refguide/action.html), so that the changes are efficiently applied in a batch._

```javascript
var heap = observable({
	colors: ["violet", "green"],
	sizes: {T: "Tiny", S: "Small", M: "MEDIUM"},
	msg: [{greet: "Hello", who: "world"}]
	lastUpdate: "yesterday"
});
var oldColors = heap.colors;

patch(heap, {
	colors: ["red", "green", "blue"],
	sizes: {S: "Small", M: "Medium", L:"Large"},
	msg: {txt: ["Hello", "world"]}
	nb: new Map([2, "two"], [4, "four"]),
});
// Now:
// heap.colors === oldColors  (Reusing the old observable array)
// heap.colors[0] === "red"  (Changed)
// heap.colors[1] === "green"  (Reused)
// heap.colors[2] === "black"  (Added)
// heap.sizes.T === undefined  (Removed)
// heap.sizes.S === "Small"  (Reused)
// heap.sizes.M === "Medium"  (Changed)
// heap.msg  (Changed to an observable plain object)
// heap.msg.txt[0] === "Hello"  (Added)
// heap.cities.get(4) === "four"  (Added)
// heap.lastUpdate === undefined  (Removed)

patch.prop(heap, "msg", undefined);
// Now:
// heap.msg === undefined  (Changed: the property "msg" is still present with a value of undefined)
// heap.colors === oldColors  (untouched)
```

### Extender (for computed values)

If you use an extender, you can easily and efficiently use computed values on your patched observables.

First define an extender that defines the computed values.  
Then when patching (or when creating new observable plain objects), you need to pass the extender along with the properties (via the [Symbol](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol) property `patch.$extend`). The extender is used to recognize patched objects so that they can either be reused or replaced with new objects as needed. (As observable plain objects must have been created from the same extender to be reused.)

```javascript
var Animal = patch.extender({
	get COLOR () {
		return this.color.toUpperCase();
	}
});

var zoo = observable({
	cat: {color: "red", [patch.$extend]: Animal},
	turtle: {color: "yellow", [patch.$extend]: Animal},
});
var oldCat = zoo.cat;

autorun(() => console.log("Cat COLOR:", zoo.cat.COLOR));
autorun(() => console.log("Turtle COLOR:", zoo.turtle.COLOR));

console.log("Patching zoo...");
patch(zoo, {
	cat: {color: "red", [patch.$extend]: Animal},
	turtle: {color: "green", [patch.$extend]: Animal},
	panther: {color: "black", [patch.$extend]: Animal},
});
console.log('=> Only the "Turtle COLOR" autorun has been re-executed.');
// Now:
// zoo.cat === oldCat  (Reusing the old observable Animal)
// zoo.cat.color === "red"  (Reused)
// zoo.cat.COLOR === "RED"  (Reused, no recomputation needed)
// zoo.turtle.color === "green"  (Changed)
// zoo.turtle.COLOR === "GREEN"  (ComputedValue untouched, result recomputed)
// zoo.panther.color === "black"  (Added)
// zoo.panther.COLOR === "BLACK"  (Added)
```

### Reuse behavior:

When patching, we make sure to get the same structural result as if you had directly assigned the new values to the patched observable data structure. For instance, the patched object's own [decorator](https://mobx.js.org/refguide/modifiers.html) is executed as it should on the new values, as expected from MobX.

We reuse plain objects, arrays and [ES6 Maps](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map) only if there is already an observable value of the same type (plain object, array or Map). Otherwise it is replaced by a newly created value of that type.

### API

_Note: the `.objToMap(...)` functions only convert plain object that have not been created from an extender._

#### patch(observable, newValues)

`observable`: an observable of type plain object, array or Map. The target that is patched.  
`newValues`: a plain object, array or Map. Contains the properties that are assigned to the target.  
Returns: `observable`.  

```javascript
var stateObj = observable({key: "val"});
patch(stateObj, {key: "val", newKey: "newVal"});
var stateArr = observable(["zero"]);
patch(stateArr, ["zero", "one"]);
```

_Note: to convert all plain objects to Maps, use: `patch.objToMap(...)` instead._

#### patch.prop(observable, property, newValue)

`observable`: an observable of type plain object, array or Map.  
`property`: the property that is patched.  
`newValue`: anything. The new value that is assigned to the property of the observable.  
Returns: `observable`.  

```javascript
var stateObj = observable({key: "val"});
patch.prop(stateObj, "newKey", "newVal");
var stateArr = observable(["zero"]);
patch.prop(stateArr, 1, "one");
```

_Note: to convert all plain objects to Maps, use: `patch.prop.objToMap(...)` instead._

#### patch.boxed(box, newValue)

`box`: an [observable box](https://mobx.js.org/refguide/boxed.html) (also called boxed value).  
`newValue`: anything. The new value that is assigned to observable box.  
Returns: `box`.  

```javascript
var stateObj = observable.box({key: "val"});
patch.boxed(stateObj, {key: "val", newKey: "newVal"});
var stateArr = observable.box(["zero"]);
patch.boxed(stateArr, ["zero", "one"]);
```

_Note: to convert all plain objects to Maps, use: `patch.boxed.objToMap(...)` instead._


#### patch.extender(properties)
`properties`: the computed values of the extender.  
Returns: the extender (It is actually the frozen `properties`)

```javascript
var Square = patch.extender({
	get perimeter() {
		return 4 * this.side;
	},
	get area() {
		return this.side * this.side;
	},
	set area(area) {
		this.side = Math.sqrt(area);
	},
});
```

#### patch.isExtenderOf(extender, thing)

Returns true if `thing` was created from the extender object `extender`.

```javascript
var square = observable({side: 1, [patch.$extend]: Square});
patch.isExtenderOf(Square, square);	// => true
```

#### patch.$extend

The [ES6 Symbol](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol) that, when used as a property key, specifies the extender that is to be used for the current plain object when it is turned to an observable.


The loaded Mobx instance is automatically modified to support the `patch.$extend` symbol property. Thus you can use `patch.$extend` everywhere that new observable plain objects are created by Mobx. This includes `obervable()`, `obervable.object()`. It also includes any plain object that is assigned to an observable data structure and who is automatically turned to an observable plain object by Mobx. Are excluded: `extendObservable()` and `decorate()` because they don't create new observables.

```javascript
var oneSquare = observable({side: 3, [patch.$extend]: Square});
patch(oneSquare, {side: 10, [patch.$extend]: Square});
var squaresArray = patch(observable.array([]), [
	{side: 20, [patch.$extend]: Square},
]);
squaresArray.push({side: 50, [patch.$extend]: Square});
```


## MobX-computedTree

_Requires MobX-patch._

**`computedTree`** is a computed value that is suited for computing trees of observable objects, arrays and Maps. Using the `patch` function, it recursively turns each plain object, array and [ES6 Maps](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map) into observables, and efficiently updates the resulting tree in a batch during a recomputation.

The generated observables of the tree are protected from modifications. And when the `computedTree` is not observed, it is automatically suspended and garbage collected like a computed value.

Because a `computedTree` is a `computed`, you can use the [computed API](https://mobx.js.org/refguide/computed-decorator.html) on it like `observe`, `keepAlive`, `isComputedProp`, etc. And it also accepts setters like a computed value.

Advantages over a simple computed:
- protection against modifications of the generated tree
- efficient update of tree during recomputation, reducing number of mutations
- reduced number of dependent recomputations

_Note: no need to use an [action](https://mobx.js.org/refguide/action.html) because the computedTree function is automatically wrapped in one._

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

### Defining computedTrees using ES6 Symbols

When you need to define computedTrees but you cannot specify the decorators separately, you can use the provided [ES6 symbol](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol) property `computedTree.$computedTree` to separate the computed trees from the computed values in the same properties object.

Here is a simple example:

```javascript
var Num = patch.extender({
	get neg(){	// This will be a computed value
		return -this.n;
	},
	[computedTree.$computedTree]: {
		get trig() {	// This will be a computed tree
			return {cos: Math.cos(this.n), sin: Math.sin(this.n)};
		}
	}
});
var numbers = observable({
	simple: [{n: 3, [patch.$extend]: Num}, {n: Math.PI, [patch.$extend]: Num}],
	get howMany(){	// This will be a computed value
		return this.simple.length;
	},
	[computedTree.$computedTree]: {
		get double() {	// This will be a computed tree
			return this.simple.map(o => ({n: o.n * 2, [patch.$extend]: Num}));
		}
	}
});
// Now:
// numbers.howMany === 2
// numbers.double[0].n === 6
// numbers.double[0].neg === -6
// numbers.double[1].trig.cos === 1
```

When you define computed trees under a `$computedTree` symbol, you can add the following extra symbols to control which decorators to apply to which property:
- `$decorators`: to define specific decorators for the corrent properties.
- `$defaultDecorator`: to define the default decorator for the current properties that don't have a specific decorator defined under the `$decorators` symbol.

Here is a more comprehensive example:

```javascript
var $extend = patch.$extend;
var $computedTree = computedTree.$computedTree;
var $decorators = computedTree.$decorators;
var $defaultDecorator = computedTree.$defaultDecorator;

var Car = patch.extender({
	[$computedTree]: {
		get doors() {	// This will be a computed tree
			var doors = [];
			while (doors.length < this.nbDoors) doors.push({color: this.color});
			return doors;
		}
	}
});

var garage = observable({
	cars: [
		{color: "red", nbDoors: 2, [$extend]: Car},
		{color: "red", nbDoors: 5, [$extend]: Car},
		{color: "blue", nbDoors: 2, [$extend]: Car},
		{color: "blue", nbDoors: 2, [$extend]: Car},
		{color: "white", nbDoors: 4, [$extend]: Car},
		{color: "yellow", nbDoors: 4, [$extend]: Car},
	],
	get nbTwoDoorsCars() {	// This will be a computed value
		return this.cars.filter(car => car.nbDoors === 2).length;
	},
	[$computedTree]: {
		get fourDoorsCars() {	// This will be a computed tree
			return this.cars.filter(car => car.nbDoors === 4);
		},
		get nbFourDoorsCars() {	// This will be a computed value
			return this.fourDoorsCars.length;
		},
		get carsByColors() {	// This will be a computed tree with objects converted to Maps
			var map = {};
			for (var car of this.cars) {
				if (!(car.color in map)) map[car.color] = [];
				map[car.color].push(car);
			}
			return map;
		},
		// Define specific decorators for the current properties:
		[$decorators]: {
			fourDoorsCars: computedTree,
			nbFourDoorsCars: mobx.computed,
		},
		// Define the default decorator for the current properties without specific decorator:
		[$defaultDecorator]: computedTree.objToMap
	}
});
// Now:
// garage.cars[0].doors[0].color === "red"
// garage.nbTwoDoorsCars === 3
// garage.nbFourDoorsCars === 2
// garage.fourDoorsCars[0] === garage.cars[4]
// garage.fourDoorsCars[0].doors.length === 4
// garage.fourDoorsCars[1].doors[3].color === "yellow"
// garage.carsByColors.size === 4
// garage.carsByColors.get("blue")[0].doors[0].color === "blue"
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

#### computedTree.$computedTree

The [ES6 Symbol](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol) that, when used as a property key, groups the getters that must be turned to computedTrees for the current properties object when it is turned to an observable.

#### computedTree.$decorators

The [ES6 Symbol](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol) that, when used as a property key of a `$computedTree` symbol, defines decorators for the current $computedTree properties.

#### computedTree.$defaultDecorator

The [ES6 Symbol](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol) that, when used as a property key, defines the default decorator for the current $computedTree properties which don't have a specific decorator defined under the `$decorators` symbol. Defaults to `computedTree` if undefined.