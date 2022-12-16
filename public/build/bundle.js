
(function(l, r) { if (l.getElementById('livereloadscript')) return; r = l.createElement('script'); r.async = 1; r.src = '//' + (window.location.host || 'localhost').split(':')[0] + ':35729/livereload.js?snipver=1'; r.id = 'livereloadscript'; l.getElementsByTagName('head')[0].appendChild(r) })(window.document);
var app = (function () {
    'use strict';

    function noop() { }
    function add_location(element, file, line, column, char) {
        element.__svelte_meta = {
            loc: { file, line, column, char }
        };
    }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }
    function validate_store(store, name) {
        if (store != null && typeof store.subscribe !== 'function') {
            throw new Error(`'${name}' is not a store with a 'subscribe' method`);
        }
    }
    function subscribe(store, ...callbacks) {
        if (store == null) {
            return noop;
        }
        const unsub = store.subscribe(...callbacks);
        return unsub.unsubscribe ? () => unsub.unsubscribe() : unsub;
    }
    function component_subscribe(component, store, callback) {
        component.$$.on_destroy.push(subscribe(store, callback));
    }
    function null_to_empty(value) {
        return value == null ? '' : value;
    }
    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        if (node.parentNode) {
            node.parentNode.removeChild(node);
        }
    }
    function destroy_each(iterations, detaching) {
        for (let i = 0; i < iterations.length; i += 1) {
            if (iterations[i])
                iterations[i].d(detaching);
        }
    }
    function element(name) {
        return document.createElement(name);
    }
    function svg_element(name) {
        return document.createElementNS('http://www.w3.org/2000/svg', name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_input_value(input, value) {
        input.value = value == null ? '' : value;
    }
    function custom_event(type, detail, { bubbles = false, cancelable = false } = {}) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, bubbles, cancelable, detail);
        return e;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error('Function called outside component initialization');
        return current_component;
    }
    /**
     * The `onMount` function schedules a callback to run as soon as the component has been mounted to the DOM.
     * It must be called during the component's initialisation (but doesn't need to live *inside* the component;
     * it can be called from an external module).
     *
     * `onMount` does not run inside a [server-side component](/docs#run-time-server-side-component-api).
     *
     * https://svelte.dev/docs#run-time-svelte-onmount
     */
    function onMount(fn) {
        get_current_component().$$.on_mount.push(fn);
    }
    /**
     * Creates an event dispatcher that can be used to dispatch [component events](/docs#template-syntax-component-directives-on-eventname).
     * Event dispatchers are functions that can take two arguments: `name` and `detail`.
     *
     * Component events created with `createEventDispatcher` create a
     * [CustomEvent](https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent).
     * These events do not [bubble](https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Building_blocks/Events#Event_bubbling_and_capture).
     * The `detail` argument corresponds to the [CustomEvent.detail](https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent/detail)
     * property and can contain any type of data.
     *
     * https://svelte.dev/docs#run-time-svelte-createeventdispatcher
     */
    function createEventDispatcher() {
        const component = get_current_component();
        return (type, detail, { cancelable = false } = {}) => {
            const callbacks = component.$$.callbacks[type];
            if (callbacks) {
                // TODO are there situations where events could be dispatched
                // in a server (non-DOM) environment?
                const event = custom_event(type, detail, { cancelable });
                callbacks.slice().forEach(fn => {
                    fn.call(component, event);
                });
                return !event.defaultPrevented;
            }
            return true;
        };
    }
    // TODO figure out if we still want to support
    // shorthand events, or if we want to implement
    // a real bubbling mechanism
    function bubble(component, event) {
        const callbacks = component.$$.callbacks[event.type];
        if (callbacks) {
            // @ts-ignore
            callbacks.slice().forEach(fn => fn.call(this, event));
        }
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    function add_flush_callback(fn) {
        flush_callbacks.push(fn);
    }
    // flush() calls callbacks in this order:
    // 1. All beforeUpdate callbacks, in order: parents before children
    // 2. All bind:this callbacks, in reverse order: children before parents.
    // 3. All afterUpdate callbacks, in order: parents before children. EXCEPT
    //    for afterUpdates called during the initial onMount, which are called in
    //    reverse order: children before parents.
    // Since callbacks might update component values, which could trigger another
    // call to flush(), the following steps guard against this:
    // 1. During beforeUpdate, any updated components will be added to the
    //    dirty_components array and will cause a reentrant call to flush(). Because
    //    the flush index is kept outside the function, the reentrant call will pick
    //    up where the earlier call left off and go through all dirty components. The
    //    current_component value is saved and restored so that the reentrant call will
    //    not interfere with the "parent" flush() call.
    // 2. bind:this callbacks cannot trigger new flush() calls.
    // 3. During afterUpdate, any updated components will NOT have their afterUpdate
    //    callback called a second time; the seen_callbacks set, outside the flush()
    //    function, guarantees this behavior.
    const seen_callbacks = new Set();
    let flushidx = 0; // Do *not* move this inside the flush() function
    function flush() {
        const saved_component = current_component;
        do {
            // first, call beforeUpdate functions
            // and update components
            while (flushidx < dirty_components.length) {
                const component = dirty_components[flushidx];
                flushidx++;
                set_current_component(component);
                update(component.$$);
            }
            set_current_component(null);
            dirty_components.length = 0;
            flushidx = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        seen_callbacks.clear();
        set_current_component(saved_component);
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function group_outros() {
        outros = {
            r: 0,
            c: [],
            p: outros // parent group
        };
    }
    function check_outros() {
        if (!outros.r) {
            run_all(outros.c);
        }
        outros = outros.p;
    }
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
        else if (callback) {
            callback();
        }
    }

    const globals = (typeof window !== 'undefined'
        ? window
        : typeof globalThis !== 'undefined'
            ? globalThis
            : global);

    function bind(component, name, callback, value) {
        const index = component.$$.props[name];
        if (index !== undefined) {
            component.$$.bound[index] = callback;
            if (value === undefined) {
                callback(component.$$.ctx[index]);
            }
        }
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor, customElement) {
        const { fragment, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        if (!customElement) {
            // onMount happens before the initial afterUpdate
            add_render_callback(() => {
                const new_on_destroy = component.$$.on_mount.map(run).filter(is_function);
                // if the component was destroyed immediately
                // it will update the `$$.on_destroy` reference to `null`.
                // the destructured on_destroy may still reference to the old array
                if (component.$$.on_destroy) {
                    component.$$.on_destroy.push(...new_on_destroy);
                }
                else {
                    // Edge case - component was destroyed immediately,
                    // most likely as a result of a binding initialising
                    run_all(new_on_destroy);
                }
                component.$$.on_mount = [];
            });
        }
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, append_styles, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: [],
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            on_disconnect: [],
            before_update: [],
            after_update: [],
            context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false,
            root: options.target || parent_component.$$.root
        };
        append_styles && append_styles($$.root);
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor, options.customElement);
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            if (!is_function(callback)) {
                return noop;
            }
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    function dispatch_dev(type, detail) {
        document.dispatchEvent(custom_event(type, Object.assign({ version: '3.55.0' }, detail), { bubbles: true }));
    }
    function append_dev(target, node) {
        dispatch_dev('SvelteDOMInsert', { target, node });
        append(target, node);
    }
    function insert_dev(target, node, anchor) {
        dispatch_dev('SvelteDOMInsert', { target, node, anchor });
        insert(target, node, anchor);
    }
    function detach_dev(node) {
        dispatch_dev('SvelteDOMRemove', { node });
        detach(node);
    }
    function listen_dev(node, event, handler, options, has_prevent_default, has_stop_propagation) {
        const modifiers = options === true ? ['capture'] : options ? Array.from(Object.keys(options)) : [];
        if (has_prevent_default)
            modifiers.push('preventDefault');
        if (has_stop_propagation)
            modifiers.push('stopPropagation');
        dispatch_dev('SvelteDOMAddEventListener', { node, event, handler, modifiers });
        const dispose = listen(node, event, handler, options);
        return () => {
            dispatch_dev('SvelteDOMRemoveEventListener', { node, event, handler, modifiers });
            dispose();
        };
    }
    function attr_dev(node, attribute, value) {
        attr(node, attribute, value);
        if (value == null)
            dispatch_dev('SvelteDOMRemoveAttribute', { node, attribute });
        else
            dispatch_dev('SvelteDOMSetAttribute', { node, attribute, value });
    }
    function set_data_dev(text, data) {
        data = '' + data;
        if (text.wholeText === data)
            return;
        dispatch_dev('SvelteDOMSetData', { node: text, data });
        text.data = data;
    }
    function validate_each_argument(arg) {
        if (typeof arg !== 'string' && !(arg && typeof arg === 'object' && 'length' in arg)) {
            let msg = '{#each} only iterates over array-like objects.';
            if (typeof Symbol === 'function' && arg && Symbol.iterator in arg) {
                msg += ' You can use a spread to convert this iterable into an array.';
            }
            throw new Error(msg);
        }
    }
    function validate_slots(name, slot, keys) {
        for (const slot_key of Object.keys(slot)) {
            if (!~keys.indexOf(slot_key)) {
                console.warn(`<${name}> received an unexpected slot "${slot_key}".`);
            }
        }
    }
    /**
     * Base class for Svelte components with some minor dev-enhancements. Used when dev=true.
     */
    class SvelteComponentDev extends SvelteComponent {
        constructor(options) {
            if (!options || (!options.target && !options.$$inline)) {
                throw new Error("'target' is a required option");
            }
            super();
        }
        $destroy() {
            super.$destroy();
            this.$destroy = () => {
                console.warn('Component was already destroyed'); // eslint-disable-line no-console
            };
        }
        $capture_state() { }
        $inject_state() { }
    }

    const subscriber_queue = [];
    /**
     * Create a `Writable` store that allows both updating and reading by subscription.
     * @param {*=}value initial value
     * @param {StartStopNotifier=}start start and stop notifications for subscriptions
     */
    function writable(value, start = noop) {
        let stop;
        const subscribers = new Set();
        function set(new_value) {
            if (safe_not_equal(value, new_value)) {
                value = new_value;
                if (stop) { // store is ready
                    const run_queue = !subscriber_queue.length;
                    for (const subscriber of subscribers) {
                        subscriber[1]();
                        subscriber_queue.push(subscriber, value);
                    }
                    if (run_queue) {
                        for (let i = 0; i < subscriber_queue.length; i += 2) {
                            subscriber_queue[i][0](subscriber_queue[i + 1]);
                        }
                        subscriber_queue.length = 0;
                    }
                }
            }
        }
        function update(fn) {
            set(fn(value));
        }
        function subscribe(run, invalidate = noop) {
            const subscriber = [run, invalidate];
            subscribers.add(subscriber);
            if (subscribers.size === 1) {
                stop = start(set) || noop;
            }
            run(value);
            return () => {
                subscribers.delete(subscriber);
                if (subscribers.size === 0) {
                    stop();
                    stop = null;
                }
            };
        }
        return { set, update, subscribe };
    }

    let darkmode = writable(false);

    /* src/components/Search.svelte generated by Svelte v3.55.0 */

    const file = "src/components/Search.svelte";

    function create_fragment(ctx) {
    	let div1;
    	let div0;
    	let input;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			div1 = element("div");
    			div0 = element("div");
    			input = element("input");
    			attr_dev(input, "type", "text");
    			attr_dev(input, "placeholder", "Search");
    			attr_dev(input, "class", "svelte-1nki6g5");
    			add_location(input, file, 8, 8, 105);
    			attr_dev(div0, "class", "Search-container");
    			add_location(div0, file, 7, 4, 66);
    			attr_dev(div1, "class", "Search");
    			add_location(div1, file, 6, 0, 41);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div1, anchor);
    			append_dev(div1, div0);
    			append_dev(div0, input);
    			set_input_value(input, /*query*/ ctx[0]);

    			if (!mounted) {
    				dispose = [
    					listen_dev(input, "input", /*input_input_handler*/ ctx[2]),
    					listen_dev(input, "input", /*input_handler*/ ctx[1], false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: function update(ctx, [dirty]) {
    			if (dirty & /*query*/ 1 && input.value !== /*query*/ ctx[0]) {
    				set_input_value(input, /*query*/ ctx[0]);
    			}
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div1);
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Search', slots, []);
    	let query = '';
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Search> was created with unknown prop '${key}'`);
    	});

    	function input_handler(event) {
    		bubble.call(this, $$self, event);
    	}

    	function input_input_handler() {
    		query = this.value;
    		$$invalidate(0, query);
    	}

    	$$self.$capture_state = () => ({ query });

    	$$self.$inject_state = $$props => {
    		if ('query' in $$props) $$invalidate(0, query = $$props.query);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [query, input_handler, input_input_handler];
    }

    class Search extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance, create_fragment, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Search",
    			options,
    			id: create_fragment.name
    		});
    	}
    }

    /* src/components/Switch.svelte generated by Svelte v3.55.0 */

    const { console: console_1 } = globals;
    const file$1 = "src/components/Switch.svelte";

    function create_fragment$1(ctx) {
    	let div1;
    	let div0;
    	let button;
    	let div0_class_value;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			div1 = element("div");
    			div0 = element("div");
    			button = element("button");
    			attr_dev(button, "class", "circle svelte-1lt0g3w");
    			add_location(button, file$1, 25, 7, 626);

    			attr_dev(div0, "class", div0_class_value = "" + (null_to_empty(/*$darkmode*/ ctx[0]
    			? 'switch-container on'
    			: 'switch-container') + " svelte-1lt0g3w"));

    			add_location(div0, file$1, 24, 4, 549);
    			attr_dev(div1, "class", "Switch");
    			add_location(div1, file$1, 23, 0, 524);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div1, anchor);
    			append_dev(div1, div0);
    			append_dev(div0, button);

    			if (!mounted) {
    				dispose = listen_dev(button, "click", /*changeTheme*/ ctx[1], false, false, false);
    				mounted = true;
    			}
    		},
    		p: function update(ctx, [dirty]) {
    			if (dirty & /*$darkmode*/ 1 && div0_class_value !== (div0_class_value = "" + (null_to_empty(/*$darkmode*/ ctx[0]
    			? 'switch-container on'
    			: 'switch-container') + " svelte-1lt0g3w"))) {
    				attr_dev(div0, "class", div0_class_value);
    			}
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div1);
    			mounted = false;
    			dispose();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$1.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$1($$self, $$props, $$invalidate) {
    	let $darkmode;
    	validate_store(darkmode, 'darkmode');
    	component_subscribe($$self, darkmode, $$value => $$invalidate(0, $darkmode = $$value));
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Switch', slots, []);

    	function changeTheme() {
    		darkmode.update(x => !$darkmode);

    		fetch("http://localhost:3001/darkmode", {
    			// Adding method type 
    			method: "POST",
    			// Adding body or contents to send 
    			body: JSON.stringify({ darkmode: $darkmode }),
    			// Adding headers to the request 
    			headers: {
    				"Content-type": "application/json; charset=UTF-8"
    			}
    		}).then(response => response.json()).then(res => console.log(res));
    	}

    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console_1.warn(`<Switch> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({ darkmode, changeTheme, $darkmode });
    	return [$darkmode, changeTheme];
    }

    class Switch extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$1, create_fragment$1, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Switch",
    			options,
    			id: create_fragment$1.name
    		});
    	}
    }

    /* src/components/Settings.svelte generated by Svelte v3.55.0 */
    const file$2 = "src/components/Settings.svelte";

    function create_fragment$2(ctx) {
    	let div;
    	let switch_1;
    	let current;
    	switch_1 = new Switch({ $$inline: true });

    	const block = {
    		c: function create() {
    			div = element("div");
    			create_component(switch_1.$$.fragment);
    			attr_dev(div, "class", "Settings svelte-fk7wva");
    			add_location(div, file$2, 4, 0, 58);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			mount_component(switch_1, div, null);
    			current = true;
    		},
    		p: noop,
    		i: function intro(local) {
    			if (current) return;
    			transition_in(switch_1.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(switch_1.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    			destroy_component(switch_1);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$2.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$2($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Settings', slots, []);
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Settings> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({ Switch });
    	return [];
    }

    class Settings extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$2, create_fragment$2, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Settings",
    			options,
    			id: create_fragment$2.name
    		});
    	}
    }

    /* src/components/Header.svelte generated by Svelte v3.55.0 */
    const file$3 = "src/components/Header.svelte";

    function create_fragment$3(ctx) {
    	let div2;
    	let div1;
    	let div0;
    	let h1;
    	let t1;
    	let search;
    	let t2;
    	let settings;
    	let current;
    	search = new Search({ $$inline: true });
    	search.$on("input", /*input_handler*/ ctx[0]);
    	settings = new Settings({ $$inline: true });

    	const block = {
    		c: function create() {
    			div2 = element("div");
    			div1 = element("div");
    			div0 = element("div");
    			h1 = element("h1");
    			h1.textContent = "Notes";
    			t1 = space();
    			create_component(search.$$.fragment);
    			t2 = space();
    			create_component(settings.$$.fragment);
    			attr_dev(h1, "class", "svelte-8xlc0v");
    			add_location(h1, file$3, 10, 12, 197);
    			attr_dev(div0, "class", "logo");
    			add_location(div0, file$3, 9, 8, 166);
    			attr_dev(div1, "class", "Header-container svelte-8xlc0v");
    			add_location(div1, file$3, 8, 4, 127);
    			attr_dev(div2, "class", "Header");
    			add_location(div2, file$3, 6, 0, 101);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div2, anchor);
    			append_dev(div2, div1);
    			append_dev(div1, div0);
    			append_dev(div0, h1);
    			append_dev(div1, t1);
    			mount_component(search, div1, null);
    			append_dev(div1, t2);
    			mount_component(settings, div1, null);
    			current = true;
    		},
    		p: noop,
    		i: function intro(local) {
    			if (current) return;
    			transition_in(search.$$.fragment, local);
    			transition_in(settings.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(search.$$.fragment, local);
    			transition_out(settings.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div2);
    			destroy_component(search);
    			destroy_component(settings);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$3.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$3($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Header', slots, []);
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Header> was created with unknown prop '${key}'`);
    	});

    	function input_handler(event) {
    		bubble.call(this, $$self, event);
    	}

    	$$self.$capture_state = () => ({ Search, Settings });
    	return [input_handler];
    }

    class Header extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$3, create_fragment$3, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Header",
    			options,
    			id: create_fragment$3.name
    		});
    	}
    }

    /* src/components/NotePlaceholder.svelte generated by Svelte v3.55.0 */

    const file$4 = "src/components/NotePlaceholder.svelte";

    function create_fragment$4(ctx) {
    	let div;
    	let button;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			div = element("div");
    			button = element("button");
    			button.textContent = "NEW NOTE";
    			attr_dev(button, "class", "svelte-glibwq");
    			add_location(button, file$4, 6, 4, 60);
    			attr_dev(div, "class", "NotePlaceholder");
    			add_location(div, file$4, 5, 0, 26);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			append_dev(div, button);

    			if (!mounted) {
    				dispose = listen_dev(button, "click", /*click_handler*/ ctx[0], false, false, false);
    				mounted = true;
    			}
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    			mounted = false;
    			dispose();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$4.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$4($$self, $$props) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('NotePlaceholder', slots, []);
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<NotePlaceholder> was created with unknown prop '${key}'`);
    	});

    	function click_handler(event) {
    		bubble.call(this, $$self, event);
    	}

    	return [click_handler];
    }

    class NotePlaceholder extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$4, create_fragment$4, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "NotePlaceholder",
    			options,
    			id: create_fragment$4.name
    		});
    	}
    }

    /* src/components/Note.svelte generated by Svelte v3.55.0 */

    const { console: console_1$1 } = globals;
    const file$5 = "src/components/Note.svelte";

    function create_fragment$5(ctx) {
    	let div5;
    	let div4;
    	let div1;
    	let div0;
    	let button0;
    	let svg0;
    	let path0;
    	let path1;
    	let circle0;
    	let circle1;
    	let circle2;
    	let circle3;
    	let t0;
    	let button1;
    	let svg1;
    	let path2;
    	let path3;
    	let div1_style_value;
    	let t1;
    	let div3;
    	let div2;
    	let input;
    	let t2;
    	let textarea;
    	let div4_style_value;
    	let div5_class_value;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			div5 = element("div");
    			div4 = element("div");
    			div1 = element("div");
    			div0 = element("div");
    			button0 = element("button");
    			svg0 = svg_element("svg");
    			path0 = svg_element("path");
    			path1 = svg_element("path");
    			circle0 = svg_element("circle");
    			circle1 = svg_element("circle");
    			circle2 = svg_element("circle");
    			circle3 = svg_element("circle");
    			t0 = space();
    			button1 = element("button");
    			svg1 = svg_element("svg");
    			path2 = svg_element("path");
    			path3 = svg_element("path");
    			t1 = space();
    			div3 = element("div");
    			div2 = element("div");
    			input = element("input");
    			t2 = space();
    			textarea = element("textarea");
    			attr_dev(path0, "d", "M0 0h24v24H0V0z");
    			attr_dev(path0, "fill", "none");
    			add_location(path0, file$5, 40, 136, 1093);
    			attr_dev(path1, "d", "M12 22C6.49 22 2 17.51 2 12S6.49 2 12 2s10 4.04 10 9c0 3.31-2.69 6-6 6h-1.77c-.28 0-.5.22-.5.5 0 .12.05.23.13.33.41.47.64 1.06.64 1.67 0 1.38-1.12 2.5-2.5 2.5zm0-18c-4.41 0-8 3.59-8 8s3.59 8 8 8c.28 0 .5-.22.5-.5 0-.16-.08-.28-.14-.35-.41-.46-.63-1.05-.63-1.65 0-1.38 1.12-2.5 2.5-2.5H16c2.21 0 4-1.79 4-4 0-3.86-3.59-7-8-7z");
    			add_location(path1, file$5, 40, 175, 1132);
    			attr_dev(circle0, "cx", "6.5");
    			attr_dev(circle0, "cy", "11.5");
    			attr_dev(circle0, "r", "1.5");
    			add_location(circle0, file$5, 40, 511, 1468);
    			attr_dev(circle1, "cx", "9.5");
    			attr_dev(circle1, "cy", "7.5");
    			attr_dev(circle1, "r", "1.5");
    			add_location(circle1, file$5, 40, 547, 1504);
    			attr_dev(circle2, "cx", "14.5");
    			attr_dev(circle2, "cy", "7.5");
    			attr_dev(circle2, "r", "1.5");
    			add_location(circle2, file$5, 40, 582, 1539);
    			attr_dev(circle3, "cx", "17.5");
    			attr_dev(circle3, "cy", "11.5");
    			attr_dev(circle3, "r", "1.5");
    			add_location(circle3, file$5, 40, 618, 1575);
    			attr_dev(svg0, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg0, "height", "24");
    			attr_dev(svg0, "viewBox", "0 0 24 24");
    			attr_dev(svg0, "width", "24");
    			attr_dev(svg0, "class", "svelte-1m17068");
    			add_location(svg0, file$5, 40, 53, 1010);
    			attr_dev(button0, "class", "svelte-1m17068");
    			add_location(button0, file$5, 40, 16, 973);
    			attr_dev(path2, "d", "M0 0h24v24H0V0z");
    			attr_dev(path2, "fill", "none");
    			add_location(path2, file$5, 41, 131, 1759);
    			attr_dev(path3, "d", "M16 9v10H8V9h8m-1.5-6h-5l-1 1H5v2h14V4h-3.5l-1-1zM18 7H6v12c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7z");
    			add_location(path3, file$5, 41, 170, 1798);
    			attr_dev(svg1, "xmlns", "http://www.w3.org/2000/svg");
    			attr_dev(svg1, "height", "24");
    			attr_dev(svg1, "viewBox", "0 0 24 24");
    			attr_dev(svg1, "width", "24");
    			attr_dev(svg1, "class", "svelte-1m17068");
    			add_location(svg1, file$5, 41, 48, 1676);
    			attr_dev(button1, "class", "svelte-1m17068");
    			add_location(button1, file$5, 41, 16, 1644);
    			attr_dev(div0, "class", "options svelte-1m17068");
    			add_location(div0, file$5, 39, 12, 935);
    			attr_dev(div1, "class", "header svelte-1m17068");

    			attr_dev(div1, "style", div1_style_value = /*$darkmode*/ ctx[3]
    			? 'background-color: ' + /*color*/ ctx[2]
    			: '');

    			add_location(div1, file$5, 38, 8, 845);
    			attr_dev(input, "placeholder", "Sin título");
    			attr_dev(input, "class", "svelte-1m17068");
    			add_location(input, file$5, 46, 16, 2031);
    			attr_dev(div2, "class", "title svelte-1m17068");
    			add_location(div2, file$5, 45, 12, 1995);
    			attr_dev(textarea, "placeholder", "Escribir...");
    			attr_dev(textarea, "name", "");
    			attr_dev(textarea, "id", "");
    			attr_dev(textarea, "cols", "30");
    			attr_dev(textarea, "rows", "10");
    			attr_dev(textarea, "class", "svelte-1m17068");
    			add_location(textarea, file$5, 48, 12, 2140);
    			attr_dev(div3, "class", "content svelte-1m17068");
    			add_location(div3, file$5, 44, 8, 1961);
    			attr_dev(div4, "class", "Note-container svelte-1m17068");

    			attr_dev(div4, "style", div4_style_value = /*$darkmode*/ ctx[3]
    			? 'background-color: #232531'
    			: 'background-color:' + /*color*/ ctx[2]);

    			add_location(div4, file$5, 37, 4, 728);
    			attr_dev(div5, "class", div5_class_value = "" + (null_to_empty(/*$darkmode*/ ctx[3] ? 'Note-darkmode' : 'Note') + " svelte-1m17068"));
    			add_location(div5, file$5, 36, 0, 671);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div5, anchor);
    			append_dev(div5, div4);
    			append_dev(div4, div1);
    			append_dev(div1, div0);
    			append_dev(div0, button0);
    			append_dev(button0, svg0);
    			append_dev(svg0, path0);
    			append_dev(svg0, path1);
    			append_dev(svg0, circle0);
    			append_dev(svg0, circle1);
    			append_dev(svg0, circle2);
    			append_dev(svg0, circle3);
    			append_dev(div0, t0);
    			append_dev(div0, button1);
    			append_dev(button1, svg1);
    			append_dev(svg1, path2);
    			append_dev(svg1, path3);
    			append_dev(div4, t1);
    			append_dev(div4, div3);
    			append_dev(div3, div2);
    			append_dev(div2, input);
    			set_input_value(input, /*title*/ ctx[0]);
    			append_dev(div3, t2);
    			append_dev(div3, textarea);
    			set_input_value(textarea, /*text*/ ctx[1]);

    			if (!mounted) {
    				dispose = [
    					listen_dev(button0, "click", /*handleChangeColor*/ ctx[4], false, false, false),
    					listen_dev(button1, "click", /*handleRemove*/ ctx[5], false, false, false),
    					listen_dev(input, "input", /*input_input_handler*/ ctx[8]),
    					listen_dev(input, "change", /*handleChange*/ ctx[6], false, false, false),
    					listen_dev(textarea, "change", /*handleChange*/ ctx[6], false, false, false),
    					listen_dev(textarea, "input", /*textarea_input_handler*/ ctx[9])
    				];

    				mounted = true;
    			}
    		},
    		p: function update(ctx, [dirty]) {
    			if (dirty & /*$darkmode, color*/ 12 && div1_style_value !== (div1_style_value = /*$darkmode*/ ctx[3]
    			? 'background-color: ' + /*color*/ ctx[2]
    			: '')) {
    				attr_dev(div1, "style", div1_style_value);
    			}

    			if (dirty & /*title*/ 1 && input.value !== /*title*/ ctx[0]) {
    				set_input_value(input, /*title*/ ctx[0]);
    			}

    			if (dirty & /*text*/ 2) {
    				set_input_value(textarea, /*text*/ ctx[1]);
    			}

    			if (dirty & /*$darkmode, color*/ 12 && div4_style_value !== (div4_style_value = /*$darkmode*/ ctx[3]
    			? 'background-color: #232531'
    			: 'background-color:' + /*color*/ ctx[2])) {
    				attr_dev(div4, "style", div4_style_value);
    			}

    			if (dirty & /*$darkmode*/ 8 && div5_class_value !== (div5_class_value = "" + (null_to_empty(/*$darkmode*/ ctx[3] ? 'Note-darkmode' : 'Note') + " svelte-1m17068"))) {
    				attr_dev(div5, "class", div5_class_value);
    			}
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div5);
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$5.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$5($$self, $$props, $$invalidate) {
    	let $darkmode;
    	validate_store(darkmode, 'darkmode');
    	component_subscribe($$self, darkmode, $$value => $$invalidate(3, $darkmode = $$value));
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Note', slots, []);
    	let { id } = $$props;
    	let { title } = $$props;
    	let { color } = $$props;
    	let { text } = $$props;
    	const dispatch = createEventDispatcher();

    	function handleChangeColor() {
    		dispatch('changecolor', { id });
    	}

    	function handleRemove() {
    		dispatch('remove', { id });
    	}

    	function handleChange() {
    		console.log('handleChange');
    		dispatch('update', { id, text, color, title });
    	}

    	$$self.$$.on_mount.push(function () {
    		if (id === undefined && !('id' in $$props || $$self.$$.bound[$$self.$$.props['id']])) {
    			console_1$1.warn("<Note> was created without expected prop 'id'");
    		}

    		if (title === undefined && !('title' in $$props || $$self.$$.bound[$$self.$$.props['title']])) {
    			console_1$1.warn("<Note> was created without expected prop 'title'");
    		}

    		if (color === undefined && !('color' in $$props || $$self.$$.bound[$$self.$$.props['color']])) {
    			console_1$1.warn("<Note> was created without expected prop 'color'");
    		}

    		if (text === undefined && !('text' in $$props || $$self.$$.bound[$$self.$$.props['text']])) {
    			console_1$1.warn("<Note> was created without expected prop 'text'");
    		}
    	});

    	const writable_props = ['id', 'title', 'color', 'text'];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console_1$1.warn(`<Note> was created with unknown prop '${key}'`);
    	});

    	function input_input_handler() {
    		title = this.value;
    		$$invalidate(0, title);
    	}

    	function textarea_input_handler() {
    		text = this.value;
    		$$invalidate(1, text);
    	}

    	$$self.$$set = $$props => {
    		if ('id' in $$props) $$invalidate(7, id = $$props.id);
    		if ('title' in $$props) $$invalidate(0, title = $$props.title);
    		if ('color' in $$props) $$invalidate(2, color = $$props.color);
    		if ('text' in $$props) $$invalidate(1, text = $$props.text);
    	};

    	$$self.$capture_state = () => ({
    		id,
    		title,
    		color,
    		text,
    		darkmode,
    		createEventDispatcher,
    		dispatch,
    		handleChangeColor,
    		handleRemove,
    		handleChange,
    		$darkmode
    	});

    	$$self.$inject_state = $$props => {
    		if ('id' in $$props) $$invalidate(7, id = $$props.id);
    		if ('title' in $$props) $$invalidate(0, title = $$props.title);
    		if ('color' in $$props) $$invalidate(2, color = $$props.color);
    		if ('text' in $$props) $$invalidate(1, text = $$props.text);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [
    		title,
    		text,
    		color,
    		$darkmode,
    		handleChangeColor,
    		handleRemove,
    		handleChange,
    		id,
    		input_input_handler,
    		textarea_input_handler
    	];
    }

    class Note extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$5, create_fragment$5, safe_not_equal, { id: 7, title: 0, color: 2, text: 1 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Note",
    			options,
    			id: create_fragment$5.name
    		});
    	}

    	get id() {
    		throw new Error("<Note>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set id(value) {
    		throw new Error("<Note>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get title() {
    		throw new Error("<Note>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set title(value) {
    		throw new Error("<Note>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get color() {
    		throw new Error("<Note>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set color(value) {
    		throw new Error("<Note>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get text() {
    		throw new Error("<Note>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set text(value) {
    		throw new Error("<Note>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    /* src/components/Dashboard.svelte generated by Svelte v3.55.0 */
    const file$6 = "src/components/Dashboard.svelte";

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[7] = list[i].id;
    	child_ctx[8] = list[i].title;
    	child_ctx[9] = list[i].color;
    	child_ctx[10] = list[i].text;
    	child_ctx[11] = list;
    	child_ctx[12] = i;
    	return child_ctx;
    }

    // (12:12) {#each notes as { id, title, color, text }
    function create_each_block(ctx) {
    	let note;
    	let updating_title;
    	let updating_text;
    	let current;

    	function note_title_binding(value) {
    		/*note_title_binding*/ ctx[2](value, /*title*/ ctx[8], /*each_value*/ ctx[11], /*each_index*/ ctx[12]);
    	}

    	function note_text_binding(value) {
    		/*note_text_binding*/ ctx[3](value, /*text*/ ctx[10], /*each_value*/ ctx[11], /*each_index*/ ctx[12]);
    	}

    	let note_props = {
    		id: /*id*/ ctx[7],
    		color: /*color*/ ctx[9]
    	};

    	if (/*title*/ ctx[8] !== void 0) {
    		note_props.title = /*title*/ ctx[8];
    	}

    	if (/*text*/ ctx[10] !== void 0) {
    		note_props.text = /*text*/ ctx[10];
    	}

    	note = new Note({ props: note_props, $$inline: true });
    	binding_callbacks.push(() => bind(note, 'title', note_title_binding, /*title*/ ctx[8]));
    	binding_callbacks.push(() => bind(note, 'text', note_text_binding, /*text*/ ctx[10]));
    	note.$on("changecolor", /*changecolor_handler*/ ctx[4]);
    	note.$on("remove", /*remove_handler*/ ctx[5]);
    	note.$on("update", /*update_handler*/ ctx[6]);

    	const block = {
    		c: function create() {
    			create_component(note.$$.fragment);
    		},
    		m: function mount(target, anchor) {
    			mount_component(note, target, anchor);
    			current = true;
    		},
    		p: function update(new_ctx, dirty) {
    			ctx = new_ctx;
    			const note_changes = {};
    			if (dirty & /*notes*/ 1) note_changes.id = /*id*/ ctx[7];
    			if (dirty & /*notes*/ 1) note_changes.color = /*color*/ ctx[9];

    			if (!updating_title && dirty & /*notes*/ 1) {
    				updating_title = true;
    				note_changes.title = /*title*/ ctx[8];
    				add_flush_callback(() => updating_title = false);
    			}

    			if (!updating_text && dirty & /*notes*/ 1) {
    				updating_text = true;
    				note_changes.text = /*text*/ ctx[10];
    				add_flush_callback(() => updating_text = false);
    			}

    			note.$set(note_changes);
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(note.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(note.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			destroy_component(note, detaching);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_each_block.name,
    		type: "each",
    		source: "(12:12) {#each notes as { id, title, color, text }",
    		ctx
    	});

    	return block;
    }

    function create_fragment$6(ctx) {
    	let div2;
    	let div1;
    	let div0;
    	let noteplaceholder;
    	let t;
    	let current;
    	noteplaceholder = new NotePlaceholder({ $$inline: true });
    	noteplaceholder.$on("click", /*click_handler*/ ctx[1]);
    	let each_value = /*notes*/ ctx[0];
    	validate_each_argument(each_value);
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
    	}

    	const out = i => transition_out(each_blocks[i], 1, 1, () => {
    		each_blocks[i] = null;
    	});

    	const block = {
    		c: function create() {
    			div2 = element("div");
    			div1 = element("div");
    			div0 = element("div");
    			create_component(noteplaceholder.$$.fragment);
    			t = space();

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			attr_dev(div0, "class", "Notes-container svelte-ejwomj");
    			add_location(div0, file$6, 9, 8, 204);
    			attr_dev(div1, "class", "Dashboard-container svelte-ejwomj");
    			add_location(div1, file$6, 8, 4, 162);
    			attr_dev(div2, "class", "Dashboard");
    			add_location(div2, file$6, 7, 0, 134);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div2, anchor);
    			append_dev(div2, div1);
    			append_dev(div1, div0);
    			mount_component(noteplaceholder, div0, null);
    			append_dev(div0, t);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(div0, null);
    			}

    			current = true;
    		},
    		p: function update(ctx, [dirty]) {
    			if (dirty & /*notes*/ 1) {
    				each_value = /*notes*/ ctx[0];
    				validate_each_argument(each_value);
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    						transition_in(each_blocks[i], 1);
    					} else {
    						each_blocks[i] = create_each_block(child_ctx);
    						each_blocks[i].c();
    						transition_in(each_blocks[i], 1);
    						each_blocks[i].m(div0, null);
    					}
    				}

    				group_outros();

    				for (i = each_value.length; i < each_blocks.length; i += 1) {
    					out(i);
    				}

    				check_outros();
    			}
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(noteplaceholder.$$.fragment, local);

    			for (let i = 0; i < each_value.length; i += 1) {
    				transition_in(each_blocks[i]);
    			}

    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(noteplaceholder.$$.fragment, local);
    			each_blocks = each_blocks.filter(Boolean);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				transition_out(each_blocks[i]);
    			}

    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div2);
    			destroy_component(noteplaceholder);
    			destroy_each(each_blocks, detaching);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$6.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$6($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Dashboard', slots, []);
    	let { notes = [] } = $$props;
    	const writable_props = ['notes'];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Dashboard> was created with unknown prop '${key}'`);
    	});

    	function click_handler(event) {
    		bubble.call(this, $$self, event);
    	}

    	function note_title_binding(value, title, each_value, each_index) {
    		each_value[each_index].title = value;
    		$$invalidate(0, notes);
    	}

    	function note_text_binding(value, text, each_value, each_index) {
    		each_value[each_index].text = value;
    		$$invalidate(0, notes);
    	}

    	function changecolor_handler(event) {
    		bubble.call(this, $$self, event);
    	}

    	function remove_handler(event) {
    		bubble.call(this, $$self, event);
    	}

    	function update_handler(event) {
    		bubble.call(this, $$self, event);
    	}

    	$$self.$$set = $$props => {
    		if ('notes' in $$props) $$invalidate(0, notes = $$props.notes);
    	};

    	$$self.$capture_state = () => ({ NotePlaceholder, Note, notes });

    	$$self.$inject_state = $$props => {
    		if ('notes' in $$props) $$invalidate(0, notes = $$props.notes);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [
    		notes,
    		click_handler,
    		note_title_binding,
    		note_text_binding,
    		changecolor_handler,
    		remove_handler,
    		update_handler
    	];
    }

    class Dashboard extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$6, create_fragment$6, safe_not_equal, { notes: 0 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Dashboard",
    			options,
    			id: create_fragment$6.name
    		});
    	}

    	get notes() {
    		throw new Error("<Dashboard>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set notes(value) {
    		throw new Error("<Dashboard>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    // Unique ID creation requires a high quality random # generator. In the browser we therefore
    // require the crypto API and do not support built-in fallback to lower quality random number
    // generators (like Math.random()).
    // getRandomValues needs to be invoked in a context where "this" is a Crypto implementation. Also,
    // find the complete implementation of crypto (msCrypto) on IE11.
    var getRandomValues = typeof crypto !== 'undefined' && crypto.getRandomValues && crypto.getRandomValues.bind(crypto) || typeof msCrypto !== 'undefined' && typeof msCrypto.getRandomValues === 'function' && msCrypto.getRandomValues.bind(msCrypto);
    var rnds8 = new Uint8Array(16);
    function rng() {
      if (!getRandomValues) {
        throw new Error('crypto.getRandomValues() not supported. See https://github.com/uuidjs/uuid#getrandomvalues-not-supported');
      }

      return getRandomValues(rnds8);
    }

    var REGEX = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i;

    function validate(uuid) {
      return typeof uuid === 'string' && REGEX.test(uuid);
    }

    /**
     * Convert array of 16 byte values to UUID string format of the form:
     * XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
     */

    var byteToHex = [];

    for (var i = 0; i < 256; ++i) {
      byteToHex.push((i + 0x100).toString(16).substr(1));
    }

    function stringify(arr) {
      var offset = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
      // Note: Be careful editing this code!  It's been tuned for performance
      // and works in ways you may not expect. See https://github.com/uuidjs/uuid/pull/434
      var uuid = (byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + '-' + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + '-' + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + '-' + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + '-' + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]]).toLowerCase(); // Consistency check for valid UUID.  If this throws, it's likely due to one
      // of the following:
      // - One or more input array values don't map to a hex octet (leading to
      // "undefined" in the uuid)
      // - Invalid input values for the RFC `version` or `variant` fields

      if (!validate(uuid)) {
        throw TypeError('Stringified UUID is invalid');
      }

      return uuid;
    }

    function v4(options, buf, offset) {
      options = options || {};
      var rnds = options.random || (options.rng || rng)(); // Per 4.4, set bits for version and `clock_seq_hi_and_reserved`

      rnds[6] = rnds[6] & 0x0f | 0x40;
      rnds[8] = rnds[8] & 0x3f | 0x80; // Copy bytes to buffer, if provided

      if (buf) {
        offset = offset || 0;

        for (var i = 0; i < 16; ++i) {
          buf[offset + i] = rnds[i];
        }

        return buf;
      }

      return stringify(rnds);
    }

    /* src/App.svelte generated by Svelte v3.55.0 */

    const { console: console_1$2 } = globals;
    const file$7 = "src/App.svelte";

    function create_fragment$7(ctx) {
    	let main;
    	let header;
    	let t0;
    	let div;
    	let t1;
    	let t2;
    	let t3;
    	let dashboard;
    	let updating_notes;
    	let main_class_value;
    	let current;
    	header = new Header({ $$inline: true });
    	header.$on("input", /*handleQuery*/ ctx[5]);

    	function dashboard_notes_binding(value) {
    		/*dashboard_notes_binding*/ ctx[9](value);
    	}

    	let dashboard_props = {};

    	if (/*copyNotes*/ ctx[0] !== void 0) {
    		dashboard_props.notes = /*copyNotes*/ ctx[0];
    	}

    	dashboard = new Dashboard({ props: dashboard_props, $$inline: true });
    	binding_callbacks.push(() => bind(dashboard, 'notes', dashboard_notes_binding, /*copyNotes*/ ctx[0]));
    	dashboard.$on("click", /*handleNew*/ ctx[3]);
    	dashboard.$on("changecolor", /*handleChangeColor*/ ctx[4]);
    	dashboard.$on("remove", /*handleRemove*/ ctx[6]);
    	dashboard.$on("update", /*handleUpdate*/ ctx[7]);

    	const block = {
    		c: function create() {
    			main = element("main");
    			create_component(header.$$.fragment);
    			t0 = space();
    			div = element("div");
    			t1 = text(/*count*/ ctx[1]);
    			t2 = text(" notes");
    			t3 = space();
    			create_component(dashboard.$$.fragment);
    			attr_dev(div, "class", "count-notes svelte-z2nimp");
    			add_location(div, file$7, 154, 1, 3643);
    			attr_dev(main, "class", main_class_value = "" + (null_to_empty(/*$darkmode*/ ctx[2] ? 'darkmode' : '') + " svelte-z2nimp"));
    			add_location(main, file$7, 152, 0, 3566);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, main, anchor);
    			mount_component(header, main, null);
    			append_dev(main, t0);
    			append_dev(main, div);
    			append_dev(div, t1);
    			append_dev(div, t2);
    			append_dev(main, t3);
    			mount_component(dashboard, main, null);
    			current = true;
    		},
    		p: function update(ctx, [dirty]) {
    			if (!current || dirty & /*count*/ 2) set_data_dev(t1, /*count*/ ctx[1]);
    			const dashboard_changes = {};

    			if (!updating_notes && dirty & /*copyNotes*/ 1) {
    				updating_notes = true;
    				dashboard_changes.notes = /*copyNotes*/ ctx[0];
    				add_flush_callback(() => updating_notes = false);
    			}

    			dashboard.$set(dashboard_changes);

    			if (!current || dirty & /*$darkmode*/ 4 && main_class_value !== (main_class_value = "" + (null_to_empty(/*$darkmode*/ ctx[2] ? 'darkmode' : '') + " svelte-z2nimp"))) {
    				attr_dev(main, "class", main_class_value);
    			}
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(header.$$.fragment, local);
    			transition_in(dashboard.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(header.$$.fragment, local);
    			transition_out(dashboard.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(main);
    			destroy_component(header);
    			destroy_component(dashboard);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$7.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function generateColor() {
    	const colors = [
    		'#DDFFC2',
    		'#FFC2C2',
    		'#FFEAC2',
    		'#C2FFD3',
    		'#C2FFEC',
    		'#C2FAFF',
    		'#C2E2FF',
    		'#CBC2FF',
    		'#EBC2FF',
    		'#FFC2F7',
    		'#FFC2D8'
    	];

    	const index = Math.floor(Math.random() * colors.length);
    	return colors[index];
    }

    function instance$7($$self, $$props, $$invalidate) {
    	let count;
    	let $darkmode;
    	validate_store(darkmode, 'darkmode');
    	component_subscribe($$self, darkmode, $$value => $$invalidate(2, $darkmode = $$value));
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('App', slots, []);
    	let notes = [];
    	let copyNotes = [];

    	onMount(async () => {
    		//const response = await fetch('/api/api.json');
    		const response = await fetch('http://localhost:3001');

    		const data = await response.json();
    		$$invalidate(8, notes = [...data.notes]);
    		$$invalidate(0, copyNotes = [...data.notes]);
    		darkmode.set(data.settings.darkmode);
    	});

    	function handleNew() {
    		const color = generateColor();
    		const note = { id: v4(), title: '', text: '', color };
    		const dataPost = new FormData();
    		dataPost.append('empresa', 'DesarrolloWeb.com');
    		dataPost.append('CIF', 'ESB00001111');
    		dataPost.append('formacion_profesional', 'EscuelaIT');

    		fetch("http://localhost:3001/add", {
    			// Adding method type 
    			method: "POST",
    			// Adding body or contents to send 
    			body: JSON.stringify(note),
    			// Adding headers to the request 
    			headers: {
    				"Content-type": "application/json; charset=UTF-8"
    			}
    		}).then(response => response.text()).then(res => console.log(res));

    		$$invalidate(8, notes = [note, ...notes]);
    		$$invalidate(0, copyNotes = [...notes]);
    	}

    	function handleChangeColor(event) {
    		const id = event.detail.id;
    		const index = notes.findIndex(note => note.id === id);
    		$$invalidate(8, notes[index].color = generateColor(), notes);
    		$$invalidate(0, copyNotes[index].color = generateColor(), copyNotes);

    		fetch("http://localhost:3001/update", {
    			// Adding method type 
    			method: "POST",
    			// Adding body or contents to send 
    			body: JSON.stringify(notes[index]),
    			// Adding headers to the request 
    			headers: {
    				"Content-type": "application/json; charset=UTF-8"
    			}
    		}).then(response => response.json()).then(res => console.log(res));
    	}

    	function handleQuery(e) {
    		const q = e.target.value.toLowerCase();

    		if (q == '') {
    			$$invalidate(0, copyNotes = [...notes]);
    			return false;
    		}

    		const results = notes.filter(note => {
    			const title = note.title.toLowerCase();
    			const text = note.text.toLowerCase();
    			return title.indexOf(q) > -1 || text.indexOf(q) > -1;
    		});

    		$$invalidate(0, copyNotes = [...results]);
    	}

    	function handleRemove(e) {
    		const id = e.detail.id;
    		const results = notes.filter(node => node.id != id);
    		$$invalidate(8, notes = [...results]);
    		$$invalidate(0, copyNotes = [...notes]);

    		fetch("http://localhost:3001/remove", {
    			// Adding method type 
    			method: "POST",
    			// Adding body or contents to send 
    			body: JSON.stringify({ id }),
    			// Adding headers to the request 
    			headers: {
    				"Content-type": "application/json; charset=UTF-8"
    			}
    		}).then(response => response.json()).then(res => console.log(res));
    	}

    	function handleUpdate(e) {
    		const note = e.detail;
    		const index = notes.findIndex(note => note.id === e.detail.id);
    		$$invalidate(8, notes[index] = e.detail, notes);
    		console.log(e.detail);

    		fetch("http://localhost:3001/update", {
    			// Adding method type 
    			method: "POST",
    			// Adding body or contents to send 
    			body: JSON.stringify(e.detail),
    			// Adding headers to the request 
    			headers: {
    				"Content-type": "application/json; charset=UTF-8"
    			}
    		}).then(response => response.json()).then(res => console.log(res));
    	}

    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console_1$2.warn(`<App> was created with unknown prop '${key}'`);
    	});

    	function dashboard_notes_binding(value) {
    		copyNotes = value;
    		$$invalidate(0, copyNotes);
    	}

    	$$self.$capture_state = () => ({
    		onMount,
    		darkmode,
    		Header,
    		Dashboard,
    		v4,
    		notes,
    		copyNotes,
    		handleNew,
    		generateColor,
    		handleChangeColor,
    		handleQuery,
    		handleRemove,
    		handleUpdate,
    		count,
    		$darkmode
    	});

    	$$self.$inject_state = $$props => {
    		if ('notes' in $$props) $$invalidate(8, notes = $$props.notes);
    		if ('copyNotes' in $$props) $$invalidate(0, copyNotes = $$props.copyNotes);
    		if ('count' in $$props) $$invalidate(1, count = $$props.count);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*notes*/ 256) {
    			 $$invalidate(1, count = notes.length);
    		}
    	};

    	return [
    		copyNotes,
    		count,
    		$darkmode,
    		handleNew,
    		handleChangeColor,
    		handleQuery,
    		handleRemove,
    		handleUpdate,
    		notes,
    		dashboard_notes_binding
    	];
    }

    class App extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$7, create_fragment$7, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "App",
    			options,
    			id: create_fragment$7.name
    		});
    	}
    }

    const app = new App({
    	target: document.body,
    	props: {
    	}
    });

    return app;

}());
//# sourceMappingURL=bundle.js.map
