const editModeState = new WeakMap();
const editScrollState = new WeakMap();

function isTargetDocument(doc) {
  const href = doc?.location?.href;
  return href === "about:newtab" || href === "about:home";
}

function formatMoney(value) {
  if (value == null || Number.isNaN(value)) {
    return "--";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatChange(value) {
  if (value == null || Number.isNaN(value)) {
    return "--";
  }

  const sign = value > 0 ? "+" : "";
  return sign + value.toFixed(2) + "%";
}

function getChangeClass(value) {
  if (value > 0) {
    return "up";
  }
  if (value < 0) {
    return "down";
  }
  return "flat";
}

function promptForSymbol(win) {
  const next = win.prompt("Enter a stock ticker");
  if (next == null) {
    return null;
  }

  const normalized = String(next)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "");

  return normalized || null;
}

function ensureBar(doc) {
  if (!isTargetDocument(doc) || !doc.body) {
    return null;
  }

  let bar = doc.getElementById("uc-stockbar");
  if (!bar) {
    bar = doc.createElement("div");
    bar.id = "uc-stockbar";
    bar.setAttribute("role", "complementary");
    bar.setAttribute("aria-label", "Stock bar");
    doc.body.appendChild(bar);
  }

  return bar;
}

function isEditing(doc) {
  return !!editModeState.get(doc);
}

function setEditing(doc, value) {
  editModeState.set(doc, !!value);
}

function makeItem(doc, quote, index, onRemove, editing) {
  const item = doc.createElement("div");
  item.className = "uc-stock-item";
  if (editing) {
    item.classList.add("is-editing");
  }
  item.draggable = true;
  item.dataset.index = String(index);

  const link = doc.createElement("a");
  link.className = "uc-stock-link";
  link.href = quote.href;
  link.target = "_blank";
  link.rel = "noreferrer noopener";

  const symbol = doc.createElement("span");
  symbol.className = "uc-symbol";
  symbol.textContent = quote.symbol;
  link.appendChild(symbol);

  const price = doc.createElement("span");
  price.className = "uc-price";
  price.textContent = quote.error ? "--" : formatMoney(quote.price);
  link.appendChild(price);

  const change = doc.createElement("span");
  change.className = "uc-change " + (quote.error ? "flat" : getChangeClass(quote.changePercent));
  change.textContent = quote.error ? "--" : formatChange(quote.changePercent);
  link.appendChild(change);

  item.appendChild(link);

  const remove = doc.createElement("button");
  remove.className = "uc-stock-remove";
  remove.type = "button";
  remove.setAttribute("aria-label", "Remove " + quote.symbol);
  remove.textContent = "×";
  remove.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    onRemove(index);
  });
  item.appendChild(remove);

  return item;
}

function getItemFromEvent(event) {
  const target = event.target;
  if (!target || typeof target.closest !== "function") {
    return null;
  }

  return target.closest(".uc-stock-item");
}

function focusMenuSibling(button, direction) {
  const item = button.closest(".context-menu-item");
  const sibling = direction < 0 ? item?.previousElementSibling : item?.nextElementSibling;
  sibling?.querySelector('[role="menuitem"]')?.focus();
}

function createMenuItem(doc, option) {
  const { label, onActivate, closeMenu, first, last } = option;
  const item = doc.createElement("li");
  item.className = "context-menu-item";
  item.setAttribute("role", "presentation");

  const button = doc.createElement("button");
  button.type = "button";
  button.setAttribute("role", "menuitem");
  button.textContent = label;

  button.addEventListener("click", async event => {
    event.stopPropagation();
    closeMenu();
    await onActivate();
  });

  button.addEventListener("keydown", async event => {
    switch (event.key) {
      case "Tab":
        if ((event.shiftKey && first) || (!event.shiftKey && last)) {
          closeMenu();
        }
        break;
      case "ArrowUp":
        event.preventDefault();
        focusMenuSibling(button, -1);
        break;
      case "ArrowDown":
        event.preventDefault();
        focusMenuSibling(button, 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        closeMenu();
        await onActivate();
        break;
      case "Escape":
        event.preventDefault();
        closeMenu({ restoreFocus: true });
        break;
    }
  });

  button.addEventListener("keyup", event => {
    if (event.key === " ") {
      event.preventDefault();
    }
  });

  item.appendChild(button);
  return { item, button };
}

function makeActionMenu(doc, actions) {
  const win = doc.defaultView;
  const anchor = doc.createElement("div");
  anchor.className = "uc-stock-menu-anchor";

  const button = doc.createElement("button");
  button.type = "button";
  button.className = "context-menu-button icon uc-stock-menu-button";
  button.setAttribute("aria-label", "Stock bar actions");
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  anchor.appendChild(button);

  let menu = null;
  let outsideClickListener = null;

  const closeMenu = ({ restoreFocus = false } = {}) => {
    if (!menu) {
      return;
    }

    if (outsideClickListener) {
      win.removeEventListener("click", outsideClickListener, true);
      outsideClickListener = null;
    }

    menu.remove();
    menu = null;
    anchor.classList.remove("open");
    button.setAttribute("aria-expanded", "false");

    if (restoreFocus) {
      button.focus();
    }
  };

  const openMenu = keyboardAccess => {
    if (menu) {
      return;
    }

    menu = doc.createElement("span");
    menu.className = "context-menu uc-stock-context-menu";

    const list = doc.createElement("ul");
    list.className = "context-menu-list";
    list.setAttribute("role", "menu");
    list.addEventListener("click", event => {
      event.stopPropagation();
    });
    list.addEventListener("keydown", event => {
      if (event.key !== "Tab") {
        event.stopPropagation();
      }
    });
    menu.appendChild(list);

    const items = actions.map((action, index) =>
      createMenuItem(doc, {
        label: action.label,
        onActivate: action.onActivate,
        closeMenu,
        first: index === 0,
        last: index === actions.length - 1,
      })
    );

    for (const item of items) {
      list.appendChild(item.item);
    }

    anchor.appendChild(menu);
    anchor.classList.add("open");
    button.setAttribute("aria-expanded", "true");

    if (keyboardAccess && items.length) {
      win.setTimeout(() => {
        items[0].button.focus();
      }, 0);
    }

    outsideClickListener = event => {
      if (!anchor.contains(event.target)) {
        closeMenu();
      }
    };

    win.setTimeout(() => {
      if (menu && outsideClickListener) {
        win.addEventListener("click", outsideClickListener, true);
      }
    }, 0);
  };

  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();

    if (menu) {
      closeMenu();
    } else {
      openMenu(false);
    }
  });

  button.addEventListener("keydown", event => {
    switch (event.key) {
      case "Enter":
      case " ":
      case "ArrowDown":
        event.preventDefault();
        if (menu) {
          closeMenu();
        } else {
          openMenu(true);
        }
        break;
      case "Escape":
        if (menu) {
          event.preventDefault();
          closeMenu({ restoreFocus: true });
        }
        break;
    }
  });

  anchor._ucCleanup = () => {
    closeMenu();
  };

  return anchor;
}

function makeDoneButton(doc, onDone) {
  const anchor = doc.createElement("div");
  anchor.className = "uc-stock-menu-anchor";

  const button = doc.createElement("button");
  button.type = "button";
  button.className = "context-menu-button icon uc-stock-done-button";
  button.setAttribute("aria-label", "Done editing stock bar");
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    onDone();
  });
  anchor.appendChild(button);
  anchor._ucCleanup = () => {};
  return anchor;
}

function installDnD(bar, onMove) {
  bar._ucMoveSymbol = onMove;
  if (bar._ucDnDInstalled) {
    return;
  }
  bar._ucDnDInstalled = true;

  let dragIndex = null;

  bar.addEventListener("dragstart", event => {
    const item = getItemFromEvent(event);
    if (!item) {
      return;
    }

    dragIndex = Number(item.dataset.index);
    item.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(dragIndex));
  });

  bar.addEventListener("dragend", event => {
    const item = getItemFromEvent(event);
    item?.classList.remove("is-dragging");
    dragIndex = null;

    bar.querySelectorAll(".uc-stock-item.is-drop-target").forEach(node => {
      node.classList.remove("is-drop-target");
    });
  });

  bar.addEventListener("dragover", event => {
    const item = getItemFromEvent(event);
    if (!item || dragIndex == null) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    bar.querySelectorAll(".uc-stock-item.is-drop-target").forEach(node => {
      if (node !== item) {
        node.classList.remove("is-drop-target");
      }
    });
    item.classList.add("is-drop-target");
  });

  bar.addEventListener("dragleave", event => {
    const item = getItemFromEvent(event);
    if (!item) {
      return;
    }

    item.classList.remove("is-drop-target");
  });

  bar.addEventListener("drop", event => {
    const item = getItemFromEvent(event);
    if (!item || dragIndex == null) {
      return;
    }

    event.preventDefault();
    item.classList.remove("is-drop-target");

    const targetIndex = Number(item.dataset.index);
    if (!Number.isNaN(targetIndex) && targetIndex !== dragIndex) {
      bar._ucMoveSymbol?.(dragIndex, targetIndex);
    }
  });
}

function installTickerBehavior(doc, bar, viewport, track, primaryStrip, editing) {
  const win = doc.defaultView;
  let frameId = 0;

  function resetTicker() {
    track.classList.remove("is-marquee");
    viewport.classList.remove("is-marquee", "is-edit-scroll");
    viewport.style.removeProperty("width");
    track.style.removeProperty("--uc-stock-scroll-distance");
    track.style.removeProperty("--uc-stock-scroll-duration");
    track.querySelector(".uc-stock-strip.is-clone")?.remove();
  }

  function syncTicker() {
    resetTicker();

    const viewportWidth = Math.floor(win.innerWidth * 0.7);
    const contentWidth = Math.ceil(primaryStrip.getBoundingClientRect().width);
    if (!viewportWidth || contentWidth <= viewportWidth) {
      return;
    }

    viewport.style.width = `${viewportWidth}px`;

    if (editing) {
      viewport.classList.add("is-edit-scroll");
      viewport.scrollLeft = editScrollState.get(doc) || 0;
      return;
    }

    const cloneStrip = primaryStrip.cloneNode(true);
    cloneStrip.classList.add("is-clone");
    cloneStrip.setAttribute("aria-hidden", "true");
    cloneStrip.querySelectorAll("a, button").forEach(node => {
      node.setAttribute("tabindex", "-1");
    });
    track.appendChild(cloneStrip);

    const gapValue = win.getComputedStyle(track).columnGap || win.getComputedStyle(track).gap || "0";
    const gap = Number.parseFloat(gapValue) || 0;
    const distance = contentWidth + gap;
    const duration = Math.max(18, distance / 40);

    viewport.classList.add("is-marquee");
    track.classList.add("is-marquee");
    track.style.setProperty("--uc-stock-scroll-distance", `${distance}px`);
    track.style.setProperty("--uc-stock-scroll-duration", `${duration}s`);
  }

  function queueSync() {
    if (frameId) {
      win.cancelAnimationFrame(frameId);
    }
    frameId = win.requestAnimationFrame(() => {
      frameId = 0;
      syncTicker();
    });
  }

  queueSync();
  win.addEventListener("resize", queueSync);

  if (editing) {
    viewport.addEventListener("scroll", () => {
      editScrollState.set(doc, viewport.scrollLeft);
    }, { passive: true });
  } else {
    editScrollState.set(doc, 0);
  }

  return () => {
    if (editing) {
      editScrollState.set(doc, viewport.scrollLeft);
    }
    if (frameId) {
      win.cancelAnimationFrame(frameId);
    }
    win.removeEventListener("resize", queueSync);
  };
}

function render(doc, payload, actor) {
  const bar = ensureBar(doc);
  if (!bar) {
    return;
  }

  bar._ucCleanup?.();
  bar._ucCleanup = null;

  const editing = isEditing(doc);
  const quotes = payload?.quotes || [];
  bar.textContent = "";
  bar.dataset.count = String(quotes.length);
  bar.classList.toggle("is-editing", editing);

  const viewport = doc.createElement("div");
  viewport.className = "uc-stock-track-viewport";

  const track = doc.createElement("div");
  track.className = "uc-stock-track";

  const primaryStrip = doc.createElement("div");
  primaryStrip.className = "uc-stock-strip";

  const removeSymbol = async index => {
    try {
      const nextPayload = await actor.sendQuery("RemoveSymbol", { index });
      render(doc, nextPayload, actor);
    } catch (error) {
      Cu.reportError(error);
    }
  };

  const addSymbol = async () => {
    const symbol = promptForSymbol(doc.defaultView);
    if (!symbol) {
      return;
    }

    try {
      const nextPayload = await actor.sendQuery("AddSymbol", { symbol });
      render(doc, nextPayload, actor);
    } catch (error) {
      Cu.reportError(error);
    }
  };

  const refreshQuotes = async () => {
    try {
      const nextPayload = await actor.sendQuery("RefreshQuotes");
      render(doc, nextPayload, actor);
    } catch (error) {
      Cu.reportError(error);
    }
  };

  const toggleEditMode = value => {
    setEditing(doc, value);
    render(doc, payload, actor);
  };

  const moveSymbol = async (fromIndex, toIndex) => {
    try {
      const nextPayload = await actor.sendQuery("MoveSymbol", { fromIndex, toIndex });
      render(doc, nextPayload, actor);
    } catch (error) {
      Cu.reportError(error);
    }
  };

  quotes.forEach((quote, index) => {
    primaryStrip.appendChild(makeItem(doc, quote, index, removeSymbol, editing));
  });

  track.appendChild(primaryStrip);
  viewport.appendChild(track);
  bar.appendChild(viewport);

  const actionControl = editing
    ? makeDoneButton(doc, () => toggleEditMode(false))
    : makeActionMenu(doc, [
        { label: "Add", onActivate: addSymbol },
        { label: "Refresh", onActivate: refreshQuotes },
        { label: "Edit", onActivate: async () => toggleEditMode(true) },
      ]);

  bar.appendChild(actionControl);

  installDnD(track, moveSymbol);

  const cleanupTicker = installTickerBehavior(doc, bar, viewport, track, primaryStrip, editing);
  bar._ucCleanup = () => {
    actionControl._ucCleanup?.();
    cleanupTicker?.();
  };
}

export class UCBottomStocksChild extends JSWindowActorChild {
  async renderNow(doc) {
    if (!doc || !isTargetDocument(doc)) {
      return;
    }

    try {
      const payload = await this.sendQuery("RequestQuotes");
      render(doc, payload, this);
    } catch (error) {
      Cu.reportError(error);
    }
  }

  async handleEvent(event) {
    const doc = event.target;
    if (!doc || !isTargetDocument(doc)) {
      return;
    }

    if (event.type === "DOMContentLoaded" && doc.readyState === "loading") {
      return;
    }

    await this.renderNow(doc);
  }

  async receiveMessage(message) {
    switch (message.name) {
      case "Render":
        await this.renderNow(this.contentWindow?.document);
        break;
    }
  }
}
