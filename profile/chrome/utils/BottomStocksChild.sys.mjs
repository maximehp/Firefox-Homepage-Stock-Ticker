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

function makeItem(doc, quote, index, onRemove) {
  const item = doc.createElement("div");
  item.className = "uc-stock-item";
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

function makeAddButton(doc, onAdd) {
  const button = doc.createElement("button");
  button.className = "uc-stock-add";
  button.type = "button";
  button.setAttribute("aria-label", "Add stock ticker");

  const plus = doc.createElement("span");
  plus.className = "uc-stock-add-icon";
  plus.textContent = "+";
  button.appendChild(plus);

  button.addEventListener("click", onAdd);
  return button;
}

function getItemFromEvent(event) {
  const target = event.target;
  if (!target || typeof target.closest !== "function") {
    return null;
  }

  return target.closest(".uc-stock-item");
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

function render(doc, payload, actor) {
  const bar = ensureBar(doc);
  if (!bar) {
    return;
  }

  const quotes = payload?.quotes || [];
  bar.textContent = "";
  bar.dataset.count = String(quotes.length);

  const track = doc.createElement("div");
  track.className = "uc-stock-track";

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

  const moveSymbol = async (fromIndex, toIndex) => {
    try {
      const nextPayload = await actor.sendQuery("MoveSymbol", { fromIndex, toIndex });
      render(doc, nextPayload, actor);
    } catch (error) {
      Cu.reportError(error);
    }
  };

  quotes.forEach((quote, index) => {
    track.appendChild(makeItem(doc, quote, index, removeSymbol));
  });

  bar.appendChild(track);
  bar.appendChild(makeAddButton(doc, addSymbol));
  installDnD(track, moveSymbol);
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
