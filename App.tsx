import React, { useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import {
  Alert,
  Animated,
  BackHandler,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from "react-native";

type Person = {
  id: string;
  name: string;
  personal: string;
};

type AmountRow = {
  id: string;
  label: string;
  total: string;
};

type PercentRow = {
  id: string;
  label: string;
  percent: string;
};

type SpecificSplitRow = {
  id: string;
  label: string;
  total: string;
  shares: Record<string, string>;
};

type AddOnRow = {
  id: string;
  label: string;
  amounts: Record<string, string>;
};

type BillState = {
  billName?: string;
  receiptImage?: string;
  people: Person[];
  evenSplits: AmountRow[];
  specificSplits: SpecificSplitRow[];
  taxes: PercentRow[];
  staticDiscounts: AmountRow[];
  fairDiscounts: PercentRow[];
  addOns: AddOnRow[];
  payerId: string;
  paidPersonIds?: string[];
};

type AppScreen = "home" | "newBill" | "groups" | "bill";

type Totals = {
  personal: Record<string, number>;
  evenSplit: Record<string, number>;
  specificSplit: Record<string, number>;
  splitTotal: Record<string, number>;
  gross: Record<string, number>;
  tax: Record<string, number>;
  staticDiscount: Record<string, number>;
  fairDiscount: Record<string, number>;
  addOn: Record<string, number>;
  net: Record<string, number>;
  evenRows: Array<{ id: string; values: Record<string, number> }>;
  specificRows: Array<{ id: string; values: Record<string, number> }>;
  taxRows: Array<{ id: string; values: Record<string, number> }>;
  staticDiscountRows: Array<{ id: string; values: Record<string, number> }>;
  fairDiscountRows: Array<{ id: string; values: Record<string, number> }>;
  addOnRows: Array<{ id: string; values: Record<string, number> }>;
  grandTotal: number;
};

type HistoryEntry = {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  bill: BillState;
  total: number;
  peopleCount: number;
  payerName: string;
  summaryText: string;
};

type PersonGroup = {
  id: string;
  name: string;
  people: string[];
  createdAt: string;
};

const currencyLabel = "RM";
const maxCellWidth = 112;
const receiptImageMaxDimension = 1400;
const receiptImageQuality = 0.76;
const historyStorageKey = "bill-calculator-history-v1";
const groupsStorageKey = "bill-calculator-groups-v1";

const id = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const evaluateMathExpression = (value: string) => {
  const expression = value.replace(/,/g, "").replace(/\s+/g, "");

  if (!expression) {
    return 0;
  }

  if (!/^[0-9+\-*/().]+$/.test(expression)) {
    return null;
  }

  let position = 0;

  const parseNumber = () => {
    const start = position;
    let dotCount = 0;

    while (position < expression.length) {
      const char = expression[position];
      if (char === ".") {
        dotCount += 1;
        if (dotCount > 1) {
          return null;
        }
        position += 1;
        continue;
      }

      if (!/\d/.test(char)) {
        break;
      }

      position += 1;
    }

    const token = expression.slice(start, position);
    if (!token || token === ".") {
      return null;
    }

    const parsed = Number(token);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const parseFactor = (): number | null => {
    const char = expression[position];

    if (char === "+") {
      position += 1;
      return parseFactor();
    }

    if (char === "-") {
      position += 1;
      const value = parseFactor();
      return value === null ? null : -value;
    }

    if (char === "(") {
      position += 1;
      const value = parseSum();
      if (expression[position] !== ")") {
        return null;
      }
      position += 1;
      return value;
    }

    return parseNumber();
  };

  const parseTerm = (): number | null => {
    let value = parseFactor();

    while (value !== null && position < expression.length) {
      const operator = expression[position];
      if (operator !== "*" && operator !== "/") {
        break;
      }

      position += 1;
      const right = parseFactor();
      if (right === null || (operator === "/" && right === 0)) {
        return null;
      }

      value = operator === "*" ? value * right : value / right;
    }

    return value;
  };

  function parseSum(): number | null {
    let value = parseTerm();

    while (value !== null && position < expression.length) {
      const operator = expression[position];
      if (operator !== "+" && operator !== "-") {
        break;
      }

      position += 1;
      const right = parseTerm();
      if (right === null) {
        return null;
      }

      value = operator === "+" ? value + right : value - right;
    }

    return value;
  }

  const result = parseSum();
  if (result === null || position !== expression.length) {
    return null;
  }

  return Number.isFinite(result) ? result : null;
};

const parseAmount = (value: string | undefined) => {
  if (!value) {
    return 0;
  }

  const parsed = evaluateMathExpression(value);
  return parsed ?? 0;
};

const parseWholeShare = (value: string | undefined) =>
  Math.max(0, Math.floor(parseAmount(value)));

const formatMoney = (value: number) => `${currencyLabel} ${value.toFixed(2)}`;
const formatDiscountMoney = (value: number) =>
  Math.abs(value) < 0.005 ? formatMoney(0) : `-${formatMoney(value)}`;
const formatCell = (value: number) =>
  Math.abs(value) < 0.005 ? "0.00" : value.toFixed(2);

const personName = (person: Person, index: number) =>
  person.name.trim() || `Person ${index + 1}`;

const removeRecordKey = (record: Record<string, string>, key: string) => {
  const copy = { ...record };
  delete copy[key];
  return copy;
};

const responsiveCellWidthFor = (screenWidth: number) =>
  Math.max(92, Math.min(maxCellWidth, Math.floor((screenWidth - 56) / 3)));

const responsivePersonEditorWidthFor = (screenWidth: number) =>
  Math.max(142, Math.min(164, Math.floor((screenWidth - 54) / 2)));

const useResponsiveCellWidth = () => {
  const { width } = useWindowDimensions();
  return responsiveCellWidthFor(width);
};

const emptyValues = (people: Person[]) =>
  people.reduce<Record<string, number>>((acc, person) => {
    acc[person.id] = 0;
    return acc;
  }, {});

const emptyStringValues = (people: Person[]) =>
  people.reduce<Record<string, string>>((acc, person) => {
    acc[person.id] = "";
    return acc;
  }, {});

const sumValues = (people: Person[], values: Record<string, number>) =>
  people.reduce((sum, person) => sum + (values[person.id] ?? 0), 0);

const discountValuesFor = (people: Person[], totals: Totals) =>
  people.reduce<Record<string, number>>((acc, person) => {
    acc[person.id] =
      totals.staticDiscount[person.id] + totals.fairDiscount[person.id];
    return acc;
  }, {});

const receiptTotalsFor = (people: Person[], totals: Totals) => {
  const totalStaticDiscount = sumValues(people, totals.staticDiscount);
  const totalFairDiscount = sumValues(people, totals.fairDiscount);

  return {
    personal: sumValues(people, totals.personal),
    splitAmount: sumValues(people, totals.splitTotal),
    gross: sumValues(people, totals.gross),
    tax: sumValues(people, totals.tax),
    discount: totalStaticDiscount + totalFairDiscount,
    addOns: sumValues(people, totals.addOn),
    net: sumValues(people, totals.net)
  };
};

const createEvenSplit = (index: number): AmountRow => ({
  id: id("even"),
  label: `Split Total ${index}`,
  total: ""
});

const createSpecificSplit = (
  people: Person[],
  index: number
): SpecificSplitRow => ({
  id: id("specific"),
  label: `Split Specific ${index}`,
  total: "",
  shares: emptyStringValues(people)
});

const createTax = (index: number): PercentRow => ({
  id: id("tax"),
  label: `Tax ${index}`,
  percent: ""
});

const createStaticDiscount = (index: number): AmountRow => ({
  id: id("discount-static"),
  label: `Discount Split ${index}`,
  total: ""
});

const createFairDiscount = (index: number): PercentRow => ({
  id: id("discount-fair"),
  label: `Fair Discount ${index}`,
  percent: ""
});

const createAddOn = (people: Person[], index: number): AddOnRow => ({
  id: id("addon"),
  label: `Extra Add On ${index}`,
  amounts: emptyStringValues(people)
});

const createPerson = (index: number): Person => ({
  id: id("person"),
  name: `Person ${index}`,
  personal: ""
});

const createPersonFromName = (name: string, index: number): Person => ({
  id: id("person"),
  name: name.trim() || `Person ${index}`,
  personal: ""
});

const createNewBill = (names: string[] = [], billName = ""): BillState => {
  const people = names.map((name, index) =>
    createPersonFromName(name, index + 1)
  );

  return {
    billName: billName.trim(),
    receiptImage: "",
    people,
    evenSplits: [],
    specificSplits: [],
    taxes: [],
    staticDiscounts: [],
    fairDiscounts: [],
    addOns: [],
    payerId: people[0]?.id ?? "",
    paidPersonIds: []
  };
};

const computeTotals = (bill: BillState): Totals => {
  const people = bill.people;
  const count = Math.max(people.length, 1);
  const personal = emptyValues(people);
  const evenSplit = emptyValues(people);
  const specificSplit = emptyValues(people);
  const splitTotal = emptyValues(people);
  const gross = emptyValues(people);
  const tax = emptyValues(people);
  const staticDiscount = emptyValues(people);
  const fairDiscount = emptyValues(people);
  const addOn = emptyValues(people);
  const net = emptyValues(people);

  people.forEach((person) => {
    personal[person.id] = parseAmount(person.personal);
  });

  const evenRows = bill.evenSplits.map((row) => {
    const value = parseAmount(row.total) / count;
    const values = emptyValues(people);
    people.forEach((person) => {
      values[person.id] = value;
      evenSplit[person.id] += value;
    });
    return { id: row.id, values };
  });

  const specificRows = bill.specificSplits.map((row) => {
    const values = emptyValues(people);
    const total = parseAmount(row.total);
    const shareCount = people.reduce(
      (sum, person) => sum + parseWholeShare(row.shares[person.id]),
      0
    );

    if (shareCount > 0) {
      people.forEach((person) => {
        const share = parseWholeShare(row.shares[person.id]);
        const value = (total * share) / shareCount;
        values[person.id] = value;
        specificSplit[person.id] += value;
      });
    }

    return { id: row.id, values };
  });

  people.forEach((person) => {
    splitTotal[person.id] = evenSplit[person.id] + specificSplit[person.id];
    gross[person.id] = personal[person.id] + splitTotal[person.id];
  });

  const taxRows = bill.taxes.map((row) => {
    const values = emptyValues(people);
    const percentage = parseAmount(row.percent) / 100;
    people.forEach((person) => {
      const value = gross[person.id] * percentage;
      values[person.id] = value;
      tax[person.id] += value;
    });
    return { id: row.id, values };
  });

  const staticDiscountRows = bill.staticDiscounts.map((row) => {
    const value = parseAmount(row.total) / count;
    const values = emptyValues(people);
    people.forEach((person) => {
      values[person.id] = value;
      staticDiscount[person.id] += value;
    });
    return { id: row.id, values };
  });

  const fairDiscountRows = bill.fairDiscounts.map((row) => {
    const values = emptyValues(people);
    const percentage = parseAmount(row.percent) / 100;
    people.forEach((person) => {
      const value = (gross[person.id] + tax[person.id]) * percentage;
      values[person.id] = value;
      fairDiscount[person.id] += value;
    });
    return { id: row.id, values };
  });

  const addOnRows = bill.addOns.map((row) => {
    const values = emptyValues(people);
    people.forEach((person) => {
      const value = parseAmount(row.amounts[person.id]);
      values[person.id] = value;
      addOn[person.id] += value;
    });
    return { id: row.id, values };
  });

  people.forEach((person) => {
    net[person.id] =
      gross[person.id] +
      tax[person.id] -
      staticDiscount[person.id] -
      fairDiscount[person.id] +
      addOn[person.id];
  });

  return {
    personal,
    evenSplit,
    specificSplit,
    splitTotal,
    gross,
    tax,
    staticDiscount,
    fairDiscount,
    addOn,
    net,
    evenRows,
    specificRows,
    taxRows,
    staticDiscountRows,
    fairDiscountRows,
    addOnRows,
    grandTotal: sumValues(people, net)
  };
};

const cloneBill = (bill: BillState) =>
  JSON.parse(JSON.stringify(bill)) as BillState;

const hasText = (value: string | undefined) => Boolean(value?.trim());

const hasBillContent = (bill: BillState) =>
  hasText(bill.receiptImage) ||
  bill.people.some((person) => hasText(person.personal)) ||
  bill.evenSplits.some((row) => hasText(row.total)) ||
  bill.specificSplits.some(
    (row) => hasText(row.total) || Object.values(row.shares).some(hasText)
  ) ||
  bill.taxes.some((row) => hasText(row.percent)) ||
  bill.staticDiscounts.some((row) => hasText(row.total)) ||
  bill.fairDiscounts.some((row) => hasText(row.percent)) ||
  bill.addOns.some((row) => Object.values(row.amounts).some(hasText));

const parseGroupPeople = (value: string) =>
  value
    .split(/[\n,;]+/)
    .map((name) => name.trim())
    .filter(Boolean);

const getPayerId = (bill: BillState) =>
  bill.people.some((person) => person.id === bill.payerId)
    ? bill.payerId
    : bill.people[0]?.id ?? "";

const getPayerLabel = (bill: BillState) => {
  const payerId = getPayerId(bill);
  const payerIndex = bill.people.findIndex(
    (person) => person.id === payerId
  );
  const index = payerIndex >= 0 ? payerIndex : 0;
  const payer = bill.people[index];

  return payer ? personName(payer, index) : "Payer";
};

const paidPersonIdsFor = (bill: BillState) => {
  const payerId = getPayerId(bill);
  const uniquePaidIds = new Set(bill.paidPersonIds ?? []);

  return bill.people
    .map((person) => person.id)
    .filter((personId) => personId !== payerId && uniquePaidIds.has(personId));
};

const isPersonPaidToPayer = (bill: BillState, personId: string) =>
  paidPersonIdsFor(bill).includes(personId);

const getBillTitle = (bill: BillState, fallback: string) =>
  bill.billName?.trim() || fallback;

const buildPaymentSummaryText = (bill: BillState, totals: Totals) => {
  const payerLabel = getPayerLabel(bill);
  const title = getBillTitle(bill, "Bill");
  const paidPersonIds = new Set(paidPersonIdsFor(bill));
  const paymentLines =
    bill.people.length === 0
      ? ["No people added."]
      : bill.people.map((person, index) => {
        const paidLabel = paidPersonIds.has(person.id) ? " (paid)" : "";

        return `${personName(person, index)} -> ${payerLabel} ${formatMoney(
          totals.net[person.id] ?? 0
        )}${paidLabel}`;
      });

  return [
    "Bill Summary",
    `Bill: ${title}`,
    `Everything: ${formatMoney(totals.grandTotal)}`,
    `Amount of People: ${bill.people.length}`,
    `Payer: ${payerLabel}`,
    "",
    "Who pays who:",
    ...paymentLines
  ].join("\n");
};

const createHistoryEntry = (bill: BillState, entryId?: string): HistoryEntry => {
  const totals = computeTotals(bill);
  const now = new Date().toISOString();
  const payerName = getPayerLabel(bill);
  const title = getBillTitle(bill, `${payerName} bill`);

  return {
    id: entryId ?? id("history"),
    createdAt: now,
    updatedAt: now,
    title,
    bill: cloneBill(bill),
    total: totals.grandTotal,
    peopleCount: bill.people.length,
    payerName,
    summaryText: buildPaymentSummaryText(bill, totals)
  };
};

const calculateLeastTransfer = (entries: HistoryEntry[]) => {
  const paidTransferLines: string[] = [];
  const balances = entries.reduce<Record<string, number>>((acc, entry) => {
    const billTotals = computeTotals(entry.bill);
    const payerLabel = getPayerLabel(entry.bill);

    entry.bill.people.forEach((person, index) => {
      const from = personName(person, index);
      const amount = Number((billTotals.net[person.id] ?? 0).toFixed(2));
      const paid = isPersonPaidToPayer(entry.bill, person.id);

      if (amount < 0.01 || person.id === getPayerId(entry.bill)) {
        return;
      }

      if (paid) {
        paidTransferLines.push(
          `${from} -> ${payerLabel}: ${formatMoney(amount)} (paid)`
        );
        return;
      }

      acc[from] = (acc[from] ?? 0) - amount;
      acc[payerLabel] = (acc[payerLabel] ?? 0) + amount;
    });

    return acc;
  }, {});

  const debtors = Object.entries(balances)
    .map(([person, amount]) => ({ person, amount: Number(amount.toFixed(2)) }))
    .filter((item) => item.amount < -0.01)
    .sort((a, b) => a.amount - b.amount);

  const creditors = Object.entries(balances)
    .map(([person, amount]) => ({ person, amount: Number(amount.toFixed(2)) }))
    .filter((item) => item.amount > 0.01)
    .sort((a, b) => b.amount - a.amount);

  const transactions: string[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount = Math.min(Math.abs(debtor.amount), creditor.amount);
    const roundedAmount = Number(amount.toFixed(2));

    if (roundedAmount > 0.01) {
      transactions.push(
        `${debtor.person} -> ${creditor.person}: ${formatMoney(roundedAmount)}`
      );
    }

    debtor.amount = Number((debtor.amount + roundedAmount).toFixed(2));
    creditor.amount = Number((creditor.amount - roundedAmount).toFixed(2));

    if (Math.abs(debtor.amount) < 0.01) {
      debtorIndex += 1;
    }

    if (creditor.amount < 0.01) {
      creditorIndex += 1;
    }
  }

  const balanceLines = Object.entries(balances)
    .sort(([personA], [personB]) => personA.localeCompare(personB))
    .map(([person, amount]) => `${person}: ${formatMoney(amount)}`);

  return [
    "Least Transfer",
    `Selected bills: ${entries.length}`,
    "",
    "Net balances:",
    ...(balanceLines.length > 0 ? balanceLines : ["No balances."]),
    ...(paidTransferLines.length > 0
      ? ["", "Already paid:", ...paidTransferLines]
      : []),
    "",
    "Settlement:",
    ...(transactions.length > 0 ? transactions : ["Already settled."])
  ].join("\n");
};

const formatHistoryDate = (value: string) => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
};

type WebServiceWorkerRegistration = {
  active?: { postMessage: (message: unknown) => void } | null;
};

type WebServiceWorkerContainer = {
  register: (scriptUrl: string) => Promise<WebServiceWorkerRegistration>;
  ready?: Promise<WebServiceWorkerRegistration>;
};

type WebRuntime = typeof globalThis & {
  navigator?: {
    serviceWorker?: WebServiceWorkerContainer;
  };
  location?: {
    href: string;
    origin: string;
  };
  performance?: {
    getEntriesByType: (entryType: string) => Array<{ name?: string }>;
  };
};

const serviceWorkerUrlFromPage = (href: string) => {
  const cleanHref = href.split("#")[0].split("?")[0];
  const folderEnd = cleanHref.endsWith("/")
    ? cleanHref.length
    : cleanHref.lastIndexOf("/") + 1;

  return `${cleanHref.slice(0, folderEnd)}sw.js`;
};

const registerPwaServiceWorker = () => {
  if (Platform.OS !== "web" || __DEV__) {
    return;
  }

  const webRuntime = globalThis as WebRuntime;
  const serviceWorker = webRuntime.navigator?.serviceWorker;
  const pageLocation = webRuntime.location;

  if (!serviceWorker || !pageLocation) {
    return;
  }

  serviceWorker
    .register(serviceWorkerUrlFromPage(pageLocation.href))
    .then((registration) =>
      (serviceWorker.ready ?? Promise.resolve(registration)).then(
        (readyRegistration) => {
          setTimeout(() => {
            const resourceUrls =
              webRuntime.performance
                ?.getEntriesByType("resource")
                .map((entry) => entry.name)
                .filter(
                  (url): url is string =>
                    Boolean(url) && url.startsWith(pageLocation.origin)
                ) ?? [];

            readyRegistration.active?.postMessage({
              type: "CACHE_APP_SHELL",
              urls: Array.from(new Set([pageLocation.href, ...resourceUrls]))
            });
          }, 1200);
        }
      )
    )
    .catch(() => undefined);
};

const resizeReceiptImageFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("Receipt photos need a browser document."));
      return;
    }

    const image = document.createElement("img");
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      const sourceWidth = image.naturalWidth || image.width;
      const sourceHeight = image.naturalHeight || image.height;
      const scale = Math.min(
        1,
        receiptImageMaxDimension / Math.max(sourceWidth, sourceHeight)
      );
      const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
      const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");

      URL.revokeObjectURL(objectUrl);

      if (!context) {
        reject(new Error("Could not prepare receipt image."));
        return;
      }

      canvas.width = targetWidth;
      canvas.height = targetHeight;
      context.drawImage(image, 0, 0, targetWidth, targetHeight);
      resolve(canvas.toDataURL("image/jpeg", receiptImageQuality));
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read receipt image."));
    };

    image.src = objectUrl;
  });

const pickReceiptImageFromWeb = () =>
  new Promise<string | null>((resolve, reject) => {
    if (typeof document === "undefined" || !document.body) {
      resolve(null);
      return;
    }

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.setAttribute("capture", "environment");
    input.style.display = "none";

    const cleanup = () => {
      input.remove();
    };

    input.onchange = () => {
      const file = input.files?.[0];
      cleanup();

      if (!file) {
        resolve(null);
        return;
      }

      resizeReceiptImageFile(file).then(resolve).catch(reject);
    };

    document.body.appendChild(input);
    input.click();
  });

export default function App() {
  const { width: screenWidth } = useWindowDimensions();
  const [screen, setScreen] = useState<AppScreen>("home");
  const [bill, setBill] = useState<BillState>(() => createNewBill());
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [groups, setGroups] = useState<PersonGroup[]>([]);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [groupNameInput, setGroupNameInput] = useState("");
  const [groupPeopleInput, setGroupPeopleInput] = useState("");
  const [newBillNameInput, setNewBillNameInput] = useState("");
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([]);
  const [settlementText, setSettlementText] = useState("");
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const [receiptPreviewOpen, setReceiptPreviewOpen] = useState(false);
  const activeHistoryIdRef = useRef<string | null>(null);
  const skipNextHistoryPressRef = useRef(false);
  const peopleScrollRef = useRef<ScrollView>(null);
  const previousPeopleCountRef = useRef(bill.people.length);
  const transitionX = useRef(new Animated.Value(0)).current;
  const responsiveCellWidth = responsiveCellWidthFor(screenWidth);
  const responsivePersonEditorWidth = responsivePersonEditorWidthFor(screenWidth);
  const totals = useMemo(() => computeTotals(bill), [bill]);
  const summaryText = useMemo(
    () => buildPaymentSummaryText(bill, totals),
    [bill, totals]
  );
  const discountValues = useMemo(
    () => discountValuesFor(bill.people, totals),
    [bill.people, totals]
  );
  const receiptTotals = useMemo(
    () => receiptTotalsFor(bill.people, totals),
    [bill.people, totals]
  );
  const receiptTotalRows: Array<{
    label: string;
    value: string;
    isDiscount?: boolean;
    strong?: boolean;
  }> = [
    { label: "Personal total", value: formatMoney(receiptTotals.personal) },
    { label: "Split amount total", value: formatMoney(receiptTotals.splitAmount) },
    { label: "Gross amount", value: formatMoney(receiptTotals.gross) },
    { label: "Total tax", value: formatMoney(receiptTotals.tax) },
    {
      label: "Total discount",
      value: formatDiscountMoney(receiptTotals.discount),
      isDiscount: true
    },
    { label: "Extra add-ons", value: formatMoney(receiptTotals.addOns) },
    {
      label: "Net amount",
      value: formatMoney(receiptTotals.net),
      strong: true
    }
  ];
  const animatedScreenStyle = useMemo(
    () =>
      Platform.OS === "web"
        ? undefined
        : {
            transform: [{ translateX: transitionX }]
          },
    [transitionX]
  );

  const payer =
    bill.people.find((person) => person.id === bill.payerId) ?? bill.people[0];

  useEffect(() => {
    registerPwaServiceWorker();
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadSavedData = async () => {
      try {
        const [storedHistory, storedGroups] = await Promise.all([
          AsyncStorage.getItem(historyStorageKey),
          AsyncStorage.getItem(groupsStorageKey)
        ]);

        if (!mounted) {
          return;
        }

        if (storedHistory) {
          const parsedHistory = JSON.parse(storedHistory) as HistoryEntry[];
          if (Array.isArray(parsedHistory)) {
            setHistory(parsedHistory);
          }
        }

        if (storedGroups) {
          const parsedGroups = JSON.parse(storedGroups) as PersonGroup[];
          if (Array.isArray(parsedGroups)) {
            setGroups(parsedGroups);
          }
        }
      } catch {
        if (mounted) {
          Alert.alert("Saved data", "History or groups could not be loaded.");
        }
      } finally {
        if (mounted) {
          setHistoryLoaded(true);
          setGroupsLoaded(true);
        }
      }
    };

    loadSavedData();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!historyLoaded) {
      return;
    }

    AsyncStorage.setItem(historyStorageKey, JSON.stringify(history)).catch(
      () => undefined
    );
  }, [history, historyLoaded]);

  useEffect(() => {
    if (!groupsLoaded) {
      return;
    }

    AsyncStorage.setItem(groupsStorageKey, JSON.stringify(groups)).catch(
      () => undefined
    );
  }, [groups, groupsLoaded]);

  useEffect(() => {
    activeHistoryIdRef.current = activeHistoryId;
  }, [activeHistoryId]);

  useEffect(() => {
    if (!bill.receiptImage) {
      setReceiptPreviewOpen(false);
    }
  }, [bill.receiptImage]);

  useEffect(() => {
    const previousPeopleCount = previousPeopleCountRef.current;
    previousPeopleCountRef.current = bill.people.length;

    if (bill.people.length <= previousPeopleCount) {
      return;
    }

    const handle = setTimeout(() => {
      peopleScrollRef.current?.scrollToEnd({ animated: true });
    }, 50);

    return () => clearTimeout(handle);
  }, [bill.people.length]);

  const upsertBillInHistory = (sourceBill: BillState) => {
    if (!historyLoaded || !hasBillContent(sourceBill)) {
      return null;
    }

    const entryId = activeHistoryIdRef.current ?? id("history");
    const entry = createHistoryEntry(sourceBill, entryId);
    activeHistoryIdRef.current = entryId;
    setActiveHistoryId(entryId);

    setHistory((current) => {
      const existingEntry = current.find((item) => item.id === entryId);
      const savedEntry = existingEntry
        ? { ...entry, createdAt: existingEntry.createdAt }
        : entry;

      if (existingEntry) {
        return current.map((item) =>
          item.id === entryId ? savedEntry : item
        );
      }

      return [savedEntry, ...current];
    });

    return entryId;
  };

  useEffect(() => {
    if (screen !== "bill" || !historyLoaded || !hasBillContent(bill)) {
      return;
    }

    const handle = setTimeout(() => {
      upsertBillInHistory(bill);
    }, 500);

    return () => clearTimeout(handle);
  }, [bill, historyLoaded, screen]);

  const slideToScreen = (nextScreen: AppScreen) => {
    transitionX.stopAnimation();

    if (Platform.OS === "web") {
      transitionX.setValue(0);
      setScreen(nextScreen);
      return;
    }

    transitionX.setValue(72);
    setScreen(nextScreen);
    Animated.timing(transitionX, {
      toValue: 0,
      duration: 210,
      useNativeDriver: true
    }).start();
  };

  const openNewBillSetup = () => {
    if (screen === "bill") {
      upsertBillInHistory(bill);
    }

    setNewBillNameInput("");
    setSelectedHistoryIds([]);
    setSettlementText("");
    slideToScreen("newBill");
  };

  const startNewBill = (names: string[] = [], billName = newBillNameInput) => {
    const nextBill = createNewBill(names, billName);
    previousPeopleCountRef.current = nextBill.people.length;
    setBill(nextBill);
    activeHistoryIdRef.current = null;
    setActiveHistoryId(null);
    setNewBillNameInput("");
    setSelectedHistoryIds([]);
    setSettlementText("");
    slideToScreen("bill");
  };

  const backToHome = () => {
    if (screen === "home") {
      return;
    }

    if (screen === "bill") {
      upsertBillInHistory(bill);
    }

    transitionX.stopAnimation();

    const finishBackToHome = () => {
      setNewBillNameInput("");
      setSelectedHistoryIds([]);
      setSettlementText("");
      setScreen("home");
    };

    if (Platform.OS === "web") {
      transitionX.setValue(0);
      finishBackToHome();
      return;
    }

    Animated.timing(transitionX, {
      toValue: 88,
      duration: 170,
      useNativeDriver: true
    }).start(() => {
      transitionX.setValue(-42);
      finishBackToHome();
      Animated.timing(transitionX, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true
      }).start();
    });
  };

  const openGroups = () => {
    setSelectedHistoryIds([]);
    setSettlementText("");
    slideToScreen("groups");
  };

  const openHistoryEntry = (entry: HistoryEntry) => {
    const nextBill = cloneBill(entry.bill);
    previousPeopleCountRef.current = nextBill.people.length;
    setBill(nextBill);
    activeHistoryIdRef.current = entry.id;
    setActiveHistoryId(entry.id);
    setSelectedHistoryIds([]);
    setSettlementText("");
    slideToScreen("bill");
  };

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (screen === "home") {
          if (selectedHistoryIds.length > 0 || settlementText) {
            setSelectedHistoryIds([]);
            setSettlementText("");
            return true;
          }

          return false;
        }

        backToHome();
        return true;
      }
    );

    return () => subscription.remove();
  }, [bill, historyLoaded, screen, selectedHistoryIds.length, settlementText]);

  const copyText = async (text: string) => {
    try {
      await Clipboard.setStringAsync(text);
      Alert.alert("Copied", "Summary copied as text.");
    } catch {
      Alert.alert("Copy failed", "Select the summary text and copy it manually.");
    }
  };

  const toggleHistorySelection = (entryId: string) => {
    setSettlementText("");
    setSelectedHistoryIds((current) =>
      current.includes(entryId)
        ? current.filter((idValue) => idValue !== entryId)
        : [...current, entryId]
    );
  };

  const handleHistoryPress = (entry: HistoryEntry) => {
    if (skipNextHistoryPressRef.current) {
      skipNextHistoryPressRef.current = false;
      return;
    }

    if (selectedHistoryIds.length > 0) {
      toggleHistorySelection(entry.id);
      return;
    }

    openHistoryEntry(entry);
  };

  const clearHistorySelection = () => {
    setSelectedHistoryIds([]);
    setSettlementText("");
  };

  const deleteSelectedHistory = () => {
    if (selectedHistoryIds.length === 0) {
      return;
    }

    const selectedSet = new Set(selectedHistoryIds);
    const doDelete = () => {
      setHistory((current) =>
        current.filter((entry) => !selectedSet.has(entry.id))
      );

      if (activeHistoryId && selectedSet.has(activeHistoryId)) {
        activeHistoryIdRef.current = null;
        setActiveHistoryId(null);
      }

      clearHistorySelection();
    };

    if (Platform.OS === "web") {
      doDelete();
      return;
    }

    Alert.alert(
      "Delete selected",
      `Remove ${selectedHistoryIds.length} saved bills?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: doDelete }
      ]
    );
  };

  const calculateSelectedSettlement = () => {
    const selectedSet = new Set(selectedHistoryIds);
    const entries = history.filter((entry) => selectedSet.has(entry.id));

    if (entries.length === 0) {
      return;
    }

    setSettlementText(calculateLeastTransfer(entries));
  };

  const chooseReceiptImage = async () => {
    if (Platform.OS !== "web") {
      Alert.alert(
        "Receipt photo",
        "Receipt photo capture is available in the hosted web app."
      );
      return;
    }

    try {
      const receiptImage = await pickReceiptImageFromWeb();
      if (!receiptImage) {
        return;
      }

      setBill((current) => ({ ...current, receiptImage }));
    } catch {
      Alert.alert("Receipt photo", "Could not attach that receipt image.");
    }
  };

  const removeReceiptImage = () => {
    setBill((current) => ({ ...current, receiptImage: "" }));
  };

  const addGroup = () => {
    const people = parseGroupPeople(groupPeopleInput);

    if (people.length === 0) {
      Alert.alert("Group", "Add at least one person name.");
      return;
    }

    const now = new Date().toISOString();
    const nextGroup: PersonGroup = {
      id: id("group"),
      name: groupNameInput.trim() || `Group ${groups.length + 1}`,
      people,
      createdAt: now
    };

    setGroups((current) => [nextGroup, ...current]);
    setGroupNameInput("");
    setGroupPeopleInput("");
  };

  const deleteGroup = (groupId: string) => {
    setGroups((current) => current.filter((group) => group.id !== groupId));
  };

  const addPerson = () => {
    setBill((current) => {
      const nextPerson = createPerson(current.people.length + 1);
      return {
        ...current,
        people: [...current.people, nextPerson],
        specificSplits: current.specificSplits.map((row) => ({
          ...row,
          shares: { ...row.shares, [nextPerson.id]: "" }
        })),
        addOns: current.addOns.map((row) => ({
          ...row,
          amounts: { ...row.amounts, [nextPerson.id]: "" }
        })),
        payerId: current.payerId || nextPerson.id
      };
    });
  };

  const removePerson = (personId: string) => {
    setBill((current) => {
      if (!current.people.some((person) => person.id === personId)) {
        return current;
      }

      const currentPayerId = getPayerId(current);
      const people = current.people.filter((person) => person.id !== personId);
      const payerId = people.some((person) => person.id === currentPayerId)
        ? currentPayerId
        : people[0]?.id ?? "";
      const payerChanged = payerId !== currentPayerId;
      const peopleIds = new Set(people.map((person) => person.id));

      return {
        ...current,
        people,
        payerId,
        paidPersonIds: payerChanged
          ? []
          : paidPersonIdsFor(current).filter(
              (paidPersonId) =>
                paidPersonId !== personId && peopleIds.has(paidPersonId)
            ),
        specificSplits: current.specificSplits.map((row) => ({
          ...row,
          shares: removeRecordKey(row.shares, personId)
        })),
        addOns: current.addOns.map((row) => ({
          ...row,
          amounts: removeRecordKey(row.amounts, personId)
        }))
      };
    });
  };

  const updatePerson = (personId: string, patch: Partial<Person>) => {
    setBill((current) => ({
      ...current,
      people: current.people.map((person) =>
        person.id === personId ? { ...person, ...patch } : person
      )
    }));
  };

  const updatePayer = (personId: string) => {
    setBill((current) => ({
      ...current,
      payerId: personId,
      paidPersonIds:
        getPayerId(current) === personId ? paidPersonIdsFor(current) : []
    }));
  };

  const togglePaidPerson = (personId: string) => {
    setBill((current) => {
      if (personId === getPayerId(current)) {
        return current;
      }

      const paidSet = new Set(paidPersonIdsFor(current));

      if (paidSet.has(personId)) {
        paidSet.delete(personId);
      } else {
        paidSet.add(personId);
      }

      return {
        ...current,
        paidPersonIds: current.people
          .map((person) => person.id)
          .filter((currentPersonId) => paidSet.has(currentPersonId))
      };
    });
  };

  const addEvenSplit = () => {
    setBill((current) => ({
      ...current,
      evenSplits: [...current.evenSplits, createEvenSplit(current.evenSplits.length + 1)]
    }));
  };

  const updateEvenSplit = (rowId: string, patch: Partial<AmountRow>) => {
    setBill((current) => ({
      ...current,
      evenSplits: current.evenSplits.map((row) =>
        row.id === rowId ? { ...row, ...patch } : row
      )
    }));
  };

  const removeEvenSplit = (rowId: string) => {
    setBill((current) => ({
      ...current,
      evenSplits: current.evenSplits.filter((row) => row.id !== rowId)
    }));
  };

  const addSpecificSplit = () => {
    setBill((current) => ({
      ...current,
      specificSplits: [
        ...current.specificSplits,
        createSpecificSplit(current.people, current.specificSplits.length + 1)
      ]
    }));
  };

  const updateSpecificSplit = (
    rowId: string,
    patch: Partial<SpecificSplitRow>
  ) => {
    setBill((current) => ({
      ...current,
      specificSplits: current.specificSplits.map((row) =>
        row.id === rowId ? { ...row, ...patch } : row
      )
    }));
  };

  const updateSpecificShare = (
    rowId: string,
    personId: string,
    value: string
  ) => {
    setBill((current) => ({
      ...current,
      specificSplits: current.specificSplits.map((row) =>
        row.id === rowId
          ? { ...row, shares: { ...row.shares, [personId]: value } }
          : row
      )
    }));
  };

  const removeSpecificSplit = (rowId: string) => {
    setBill((current) => ({
      ...current,
      specificSplits: current.specificSplits.filter((row) => row.id !== rowId)
    }));
  };

  const addTax = () => {
    setBill((current) => ({
      ...current,
      taxes: [...current.taxes, createTax(current.taxes.length + 1)]
    }));
  };

  const updateTax = (rowId: string, patch: Partial<PercentRow>) => {
    setBill((current) => ({
      ...current,
      taxes: current.taxes.map((row) =>
        row.id === rowId ? { ...row, ...patch } : row
      )
    }));
  };

  const removeTax = (rowId: string) => {
    setBill((current) => ({
      ...current,
      taxes: current.taxes.filter((row) => row.id !== rowId)
    }));
  };

  const addStaticDiscount = () => {
    setBill((current) => ({
      ...current,
      staticDiscounts: [
        ...current.staticDiscounts,
        createStaticDiscount(current.staticDiscounts.length + 1)
      ]
    }));
  };

  const updateStaticDiscount = (rowId: string, patch: Partial<AmountRow>) => {
    setBill((current) => ({
      ...current,
      staticDiscounts: current.staticDiscounts.map((row) =>
        row.id === rowId ? { ...row, ...patch } : row
      )
    }));
  };

  const removeStaticDiscount = (rowId: string) => {
    setBill((current) => ({
      ...current,
      staticDiscounts: current.staticDiscounts.filter((row) => row.id !== rowId)
    }));
  };

  const addFairDiscount = () => {
    setBill((current) => ({
      ...current,
      fairDiscounts: [
        ...current.fairDiscounts,
        createFairDiscount(current.fairDiscounts.length + 1)
      ]
    }));
  };

  const updateFairDiscount = (rowId: string, patch: Partial<PercentRow>) => {
    setBill((current) => ({
      ...current,
      fairDiscounts: current.fairDiscounts.map((row) =>
        row.id === rowId ? { ...row, ...patch } : row
      )
    }));
  };

  const removeFairDiscount = (rowId: string) => {
    setBill((current) => ({
      ...current,
      fairDiscounts: current.fairDiscounts.filter((row) => row.id !== rowId)
    }));
  };

  const addAddOn = () => {
    setBill((current) => ({
      ...current,
      addOns: [...current.addOns, createAddOn(current.people, current.addOns.length + 1)]
    }));
  };

  const updateAddOn = (rowId: string, patch: Partial<AddOnRow>) => {
    setBill((current) => ({
      ...current,
      addOns: current.addOns.map((row) =>
        row.id === rowId ? { ...row, ...patch } : row
      )
    }));
  };

  const updateAddOnAmount = (
    rowId: string,
    personId: string,
    value: string
  ) => {
    setBill((current) => ({
      ...current,
      addOns: current.addOns.map((row) =>
        row.id === rowId
          ? { ...row, amounts: { ...row.amounts, [personId]: value } }
          : row
      )
    }));
  };

  const removeAddOn = (rowId: string) => {
    setBill((current) => ({
      ...current,
      addOns: current.addOns.filter((row) => row.id !== rowId)
    }));
  };

  if (screen === "home") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        <Animated.View style={[styles.screenShell, animatedScreenStyle]}>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.homeHero}>
              <View style={styles.homeTitleBlock}>
                <Text style={styles.kicker}>Bill Calculator</Text>
                <Text style={styles.title}>Bills</Text>
              </View>
              <Pressable onPress={openGroups} style={styles.outlineButton}>
                <Text style={styles.outlineButtonText}>Groups</Text>
              </Pressable>
            </View>

            <Section title="New bill">
              <Pressable onPress={openNewBillSetup} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>+ New bill</Text>
              </Pressable>
            </Section>

            <Section title="History">
              {!historyLoaded ? (
                <EmptyState label="Loading history" />
              ) : history.length === 0 ? (
                <EmptyState label="No saved bills yet" />
              ) : (
                <>
                  {selectedHistoryIds.length > 0 ? (
                    <View style={styles.selectionBar}>
                      <Text style={styles.selectionText}>
                        {selectedHistoryIds.length} selected
                      </Text>
                      <View style={styles.actionRow}>
                        <Pressable
                          onPress={calculateSelectedSettlement}
                          style={styles.outlineButton}
                        >
                          <Text style={styles.outlineButtonText}>
                            Least transfer
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={deleteSelectedHistory}
                          style={styles.dangerButton}
                        >
                          <Text style={styles.dangerButtonText}>Delete</Text>
                        </Pressable>
                        <Pressable
                          onPress={clearHistorySelection}
                          style={styles.outlineButton}
                        >
                          <Text style={styles.outlineButtonText}>Clear</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}

                  {settlementText ? (
                    <View style={styles.summaryTextBox}>
                      <Text selectable style={styles.summaryText}>
                        {settlementText}
                      </Text>
                      <View style={styles.actionRow}>
                        <Pressable
                          onPress={() => copyText(settlementText)}
                          style={styles.outlineButton}
                        >
                          <Text style={styles.outlineButtonText}>Copy result</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}

                  <View style={styles.historyList}>
                    {history.map((entry) => {
                      const selected = selectedHistoryIds.includes(entry.id);

                      return (
                        <Pressable
                          key={entry.id}
                          onPress={() => handleHistoryPress(entry)}
                          onLongPress={() => {
                            skipNextHistoryPressRef.current = true;
                            toggleHistorySelection(entry.id);
                          }}
                          style={[
                            styles.historyItem,
                            selected && styles.historyItemSelected
                          ]}
                        >
                          <View style={styles.historyHeader}>
                            <View style={styles.historyTitleBlock}>
                              <Text style={styles.historyTitle}>
                                {entry.title}
                              </Text>
                              <Text style={styles.historyMeta}>
                                {entry.peopleCount} people | {entry.payerName} |{" "}
                                {formatHistoryDate(entry.updatedAt)}
                              </Text>
                            </View>
                            <Text style={styles.historyTotal}>
                              {formatMoney(entry.total)}
                            </Text>
                          </View>

                          <Text
                            selectable
                            numberOfLines={5}
                            style={styles.historySummary}
                          >
                            {entry.summaryText}
                          </Text>

                          <View style={styles.actionRow}>
                            <Pressable
                              onPress={() => toggleHistorySelection(entry.id)}
                              style={[
                                styles.outlineButton,
                                selected && styles.selectedButton
                              ]}
                            >
                              <Text
                                style={[
                                  styles.outlineButtonText,
                                  selected && styles.selectedButtonText
                                ]}
                              >
                                {selected ? "Selected" : "Select"}
                              </Text>
                            </Pressable>
                            <Pressable
                              onPress={() => copyText(entry.summaryText)}
                              style={styles.outlineButton}
                            >
                              <Text style={styles.outlineButtonText}>Copy</Text>
                            </Pressable>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              )}
            </Section>
          </ScrollView>
        </Animated.View>
      </SafeAreaView>
    );
  }

  if (screen === "newBill") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        <Animated.View style={[styles.screenShell, animatedScreenStyle]}>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            stickyHeaderIndices={[0]}
          >
            <View style={styles.header}>
              <Pressable
                accessibilityLabel="Back"
                onPress={backToHome}
                style={styles.backButton}
              >
                <Text style={styles.backButtonText}>←</Text>
              </Pressable>
              <View style={styles.screenTitleBlock}>
                <Text style={styles.kicker}>New bill</Text>
                <Text style={styles.title}>Setup</Text>
              </View>
            </View>

            <Section title="Bill name">
              <TextInput
                value={newBillNameInput}
                onChangeText={setNewBillNameInput}
                placeholder="Dinner, lunch, groceries"
                style={styles.nameInput}
                placeholderTextColor="#94a3b8"
              />
            </Section>

            <Section title="Start from">
              <Pressable onPress={() => startNewBill()} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>Blank bill</Text>
              </Pressable>

              {!groupsLoaded ? (
                <EmptyState label="Loading groups" />
              ) : groups.length === 0 ? (
                <EmptyState label="No preset groups yet" />
              ) : (
                <View style={styles.groupShortcutList}>
                  {groups.map((group) => (
                    <Pressable
                      key={group.id}
                      onPress={() => startNewBill(group.people)}
                      style={styles.groupShortcut}
                    >
                      <Text style={styles.groupShortcutTitle}>{group.name}</Text>
                      <Text style={styles.groupShortcutMeta}>
                        {group.people.length} people
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </Section>
          </ScrollView>
        </Animated.View>
      </SafeAreaView>
    );
  }

  if (screen === "groups") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        <Animated.View style={[styles.screenShell, animatedScreenStyle]}>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            stickyHeaderIndices={[0]}
          >
            <View style={styles.header}>
              <Pressable
                accessibilityLabel="Back"
                onPress={backToHome}
                style={styles.backButton}
              >
                <Text style={styles.backButtonText}>←</Text>
              </Pressable>
              <View style={styles.screenTitleBlock}>
                <Text style={styles.kicker}>Settings</Text>
                <Text style={styles.title}>Groups</Text>
              </View>
            </View>

            <Section title="Create group">
              <View style={styles.formStack}>
                <View style={styles.compactField}>
                  <Text style={styles.inputLabel}>Group name</Text>
                  <TextInput
                    value={groupNameInput}
                    onChangeText={setGroupNameInput}
                    placeholder="Family dinner"
                    style={styles.nameInput}
                    placeholderTextColor="#94a3b8"
                  />
                </View>

                <View style={styles.compactField}>
                  <Text style={styles.inputLabel}>People</Text>
                  <TextInput
                    value={groupPeopleInput}
                    onChangeText={setGroupPeopleInput}
                    placeholder="Jet, Jet Kin, JK"
                    multiline
                    style={styles.multilineInput}
                    placeholderTextColor="#94a3b8"
                  />
                </View>

                <Pressable onPress={addGroup} style={styles.primaryButton}>
                  <Text style={styles.primaryButtonText}>Add group</Text>
                </Pressable>
              </View>
            </Section>

            <Section title="Saved groups">
              {!groupsLoaded ? (
                <EmptyState label="Loading groups" />
              ) : groups.length === 0 ? (
                <EmptyState label="No saved groups yet" />
              ) : (
                <View style={styles.savedGroupList}>
                  {groups.map((group) => (
                    <View key={group.id} style={styles.savedGroupItem}>
                      <View style={styles.historyTitleBlock}>
                        <Text style={styles.historyTitle}>{group.name}</Text>
                        <Text style={styles.historyMeta}>
                          {group.people.join(", ")}
                        </Text>
                      </View>
                      <View style={styles.actionRow}>
                        <Pressable
                          onPress={() => deleteGroup(group.id)}
                          style={styles.dangerButton}
                        >
                          <Text style={styles.dangerButtonText}>Delete</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </Section>
          </ScrollView>
        </Animated.View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboardArea}
      >
        <Animated.View style={[styles.screenShell, animatedScreenStyle]}>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            stickyHeaderIndices={[0]}
          >
            <View style={styles.header}>
              <Pressable
                accessibilityLabel="Back"
                onPress={backToHome}
                style={styles.backButton}
              >
                <Text style={styles.backButtonText}>←</Text>
              </Pressable>
              <View style={styles.screenTitleBlock}>
                <Text style={styles.kicker}>Bill Calculator</Text>
                <Text style={styles.title}>Split receipt</Text>
              </View>
            </View>

            <Section title="Receipt photo">
              {bill.receiptImage ? (
                <>
                  <Pressable
                    accessibilityLabel="Open receipt photo"
                    onPress={() => setReceiptPreviewOpen(true)}
                    style={styles.receiptPhotoBanner}
                  >
                    <Image
                      source={{ uri: bill.receiptImage }}
                      style={styles.receiptPhotoImage}
                      resizeMode="cover"
                    />
                    <View style={styles.receiptPhotoOverlay}>
                      <Text style={styles.receiptPhotoOverlayText}>
                        Tap to view receipt
                      </Text>
                    </View>
                  </Pressable>
                  <View style={styles.actionRow}>
                    <Pressable
                      onPress={chooseReceiptImage}
                      style={styles.outlineButton}
                    >
                      <Text style={styles.outlineButtonText}>Replace photo</Text>
                    </Pressable>
                    <Pressable
                      onPress={removeReceiptImage}
                      style={styles.dangerButton}
                    >
                      <Text style={styles.dangerButtonText}>Remove photo</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <Pressable
                  onPress={chooseReceiptImage}
                  style={styles.receiptPhotoEmpty}
                >
                  <Text style={styles.receiptPhotoEmptyTitle}>
                    Add receipt photo
                  </Text>
                  <Text style={styles.receiptPhotoEmptyText}>
                    Take or choose a photo to save with this bill.
                  </Text>
                </Pressable>
              )}
            </Section>

            <Section title="Bill name">
              <TextInput
                value={bill.billName ?? ""}
                onChangeText={(billName) =>
                  setBill((current) => ({ ...current, billName }))
                }
                placeholder="Tap to name this bill"
                style={styles.billNameInput}
                placeholderTextColor="#94a3b8"
              />
            </Section>

            <Section title="People" onAdd={addPerson} addLabel="Add person">
              {bill.people.length === 0 ? (
                <EmptyState label="No people yet" />
              ) : (
                <ScrollView
                  ref={peopleScrollRef}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                >
                  <View style={styles.personList}>
                    {bill.people.map((person, index) => (
                      <View
                        key={person.id}
                        style={[
                          styles.personEditor,
                          { width: responsivePersonEditorWidth }
                        ]}
                      >
                        <Text style={styles.inputLabel}>Name</Text>
                        <TextInput
                          value={person.name}
                          onChangeText={(name) =>
                            updatePerson(person.id, { name })
                          }
                          placeholder={`Person ${index + 1}`}
                          style={styles.nameInput}
                          placeholderTextColor="#94a3b8"
                        />
                        <Text style={styles.inputLabel}>Personal</Text>
                        <AmountInput
                          value={person.personal}
                          onChangeText={(personal) =>
                            updatePerson(person.id, { personal })
                          }
                          placeholder="0.00"
                        />
                        <Pressable
                          onPress={() => removePerson(person.id)}
                          style={styles.miniButton}
                        >
                          <Text style={styles.miniButtonText}>Remove</Text>
                        </Pressable>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              )}
            </Section>

            <Section title="Split total" onAdd={addEvenSplit} addLabel="Add row">
              {bill.evenSplits.length === 0 ? (
                <EmptyState label="No even split rows" />
              ) : (
                bill.evenSplits.map((row) => {
                  const breakdown = totals.evenRows.find(
                    (item) => item.id === row.id
                  );
                  return (
                    <AmountRowEditor
                      key={row.id}
                      labelValue={row.label}
                      amountValue={row.total}
                      amountLabel="Total"
                      onChangeLabel={(label) =>
                        updateEvenSplit(row.id, { label })
                      }
                      onChangeAmount={(total) =>
                        updateEvenSplit(row.id, { total })
                      }
                      onRemove={() => removeEvenSplit(row.id)}
                    >
                      <PersonValueStrip
                        people={bill.people}
                        values={breakdown?.values ?? emptyValues(bill.people)}
                      />
                    </AmountRowEditor>
                  );
                })
              )}
            </Section>

            <Section
              title="Split specific"
              onAdd={addSpecificSplit}
              addLabel="Add row"
            >
              {bill.specificSplits.length === 0 ? (
                <EmptyState label="No specific split rows" />
              ) : (
                bill.specificSplits.map((row) => {
                  const breakdown = totals.specificRows.find(
                    (item) => item.id === row.id
                  );
                  return (
                    <AmountRowEditor
                      key={row.id}
                      labelValue={row.label}
                      amountValue={row.total}
                      amountLabel="Total"
                      onChangeLabel={(label) =>
                        updateSpecificSplit(row.id, { label })
                      }
                      onChangeAmount={(total) =>
                        updateSpecificSplit(row.id, { total })
                      }
                      onRemove={() => removeSpecificSplit(row.id)}
                    >
                      <Text style={styles.stripLabel}>Shares</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        <View style={styles.strip}>
                          {bill.people.map((person, index) => (
                            <View
                              key={person.id}
                              style={[
                                styles.cell,
                                { width: responsiveCellWidth }
                              ]}
                            >
                              <Text numberOfLines={1} style={styles.cellName}>
                                {personName(person, index)}
                              </Text>
                              <TextInput
                                value={row.shares[person.id] ?? ""}
                                onChangeText={(value) =>
                                  updateSpecificShare(row.id, person.id, value)
                                }
                                placeholder="0"
                                keyboardType="default"
                                style={styles.cellInput}
                                autoCapitalize="none"
                                autoCorrect={false}
                                placeholderTextColor="#94a3b8"
                              />
                            </View>
                          ))}
                        </View>
                      </ScrollView>
                      <Text style={styles.stripLabel}>Amount</Text>
                      <PersonValueStrip
                        people={bill.people}
                        values={breakdown?.values ?? emptyValues(bill.people)}
                      />
                    </AmountRowEditor>
                  );
                })
              )}
            </Section>

            <Section title="Tax percentage" onAdd={addTax} addLabel="Add tax">
              {bill.taxes.length === 0 ? (
                <EmptyState label="No tax rows" />
              ) : (
                bill.taxes.map((row) => {
                  const breakdown = totals.taxRows.find(
                    (item) => item.id === row.id
                  );
                  return (
                    <PercentRowEditor
                      key={row.id}
                      labelValue={row.label}
                      percentValue={row.percent}
                      onChangeLabel={(label) => updateTax(row.id, { label })}
                      onChangePercent={(percent) =>
                        updateTax(row.id, { percent })
                      }
                      onRemove={() => removeTax(row.id)}
                    >
                      <PersonValueStrip
                        people={bill.people}
                        values={breakdown?.values ?? emptyValues(bill.people)}
                      />
                    </PercentRowEditor>
                  );
                })
              )}
            </Section>

            <Section
              title="Discount split"
              onAdd={addStaticDiscount}
              addLabel="Add discount"
            >
              {bill.staticDiscounts.length === 0 ? (
                <EmptyState label="No static discount rows" />
              ) : (
                bill.staticDiscounts.map((row) => {
                  const breakdown = totals.staticDiscountRows.find(
                    (item) => item.id === row.id
                  );
                  return (
                    <AmountRowEditor
                      key={row.id}
                      labelValue={row.label}
                      amountValue={row.total}
                      amountLabel="Discount"
                      onChangeLabel={(label) =>
                        updateStaticDiscount(row.id, { label })
                      }
                      onChangeAmount={(total) =>
                        updateStaticDiscount(row.id, { total })
                      }
                      onRemove={() => removeStaticDiscount(row.id)}
                    >
                      <PersonValueStrip
                        people={bill.people}
                        values={breakdown?.values ?? emptyValues(bill.people)}
                        isDiscount
                      />
                    </AmountRowEditor>
                  );
                })
              )}
            </Section>

            <Section
              title="Fair discount"
              onAdd={addFairDiscount}
              addLabel="Add discount"
            >
              {bill.fairDiscounts.length === 0 ? (
                <EmptyState label="No fair discount rows" />
              ) : (
                bill.fairDiscounts.map((row) => {
                  const breakdown = totals.fairDiscountRows.find(
                    (item) => item.id === row.id
                  );
                  return (
                    <PercentRowEditor
                      key={row.id}
                      labelValue={row.label}
                      percentValue={row.percent}
                      onChangeLabel={(label) =>
                        updateFairDiscount(row.id, { label })
                      }
                      onChangePercent={(percent) =>
                        updateFairDiscount(row.id, { percent })
                      }
                      onRemove={() => removeFairDiscount(row.id)}
                    >
                      <PersonValueStrip
                        people={bill.people}
                        values={breakdown?.values ?? emptyValues(bill.people)}
                        isDiscount
                      />
                    </PercentRowEditor>
                  );
                })
              )}
            </Section>

            <Section title="Extra add-ons" onAdd={addAddOn} addLabel="Add row">
              {bill.addOns.length === 0 ? (
                <EmptyState label="No add-on rows" />
              ) : (
                bill.addOns.map((row) => {
                  const breakdown = totals.addOnRows.find(
                    (item) => item.id === row.id
                  );
                  return (
                    <View key={row.id} style={styles.rowBlock}>
                      <View style={styles.rowHeader}>
                        <TextInput
                          value={row.label}
                          onChangeText={(label) => updateAddOn(row.id, { label })}
                          style={styles.labelInput}
                          placeholder="Label"
                          placeholderTextColor="#94a3b8"
                        />
                        <Pressable
                          onPress={() => removeAddOn(row.id)}
                          style={styles.removeButton}
                        >
                          <Text style={styles.removeButtonText}>x</Text>
                        </Pressable>
                      </View>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        <View style={styles.strip}>
                          {bill.people.map((person, index) => (
                            <View
                              key={person.id}
                              style={[
                                styles.cell,
                                { width: responsiveCellWidth }
                              ]}
                            >
                              <Text numberOfLines={1} style={styles.cellName}>
                                {personName(person, index)}
                              </Text>
                              <TextInput
                                value={row.amounts[person.id] ?? ""}
                                onChangeText={(value) =>
                                  updateAddOnAmount(row.id, person.id, value)
                                }
                                placeholder="0.00"
                                keyboardType="default"
                                style={styles.cellInput}
                                autoCapitalize="none"
                                autoCorrect={false}
                                placeholderTextColor="#94a3b8"
                              />
                            </View>
                          ))}
                        </View>
                      </ScrollView>
                      <Text style={styles.stripLabel}>Amount</Text>
                      <PersonValueStrip
                        people={bill.people}
                        values={breakdown?.values ?? emptyValues(bill.people)}
                      />
                    </View>
                  );
                })
              )}
            </Section>

            <Section title="Summary">
              <SummaryStrip
                title="Split amount total"
                people={bill.people}
                values={totals.splitTotal}
              />
              <SummaryStrip
                title="Gross amount"
                people={bill.people}
                values={totals.gross}
              />
              <SummaryStrip title="Tax" people={bill.people} values={totals.tax} />
              <SummaryStrip
                title="Discounts"
                people={bill.people}
                values={discountValues}
                isDiscount
              />
              <SummaryStrip
                title="Extra add-ons"
                people={bill.people}
                values={totals.addOn}
              />
              <SummaryStrip
                title="Net amount"
                people={bill.people}
                values={totals.net}
                strong
              />

              <View style={styles.receiptTotalsList}>
                {receiptTotalRows.map((row, index) => (
                  <View
                    key={row.label}
                    style={[
                      styles.receiptTotalRow,
                      index === receiptTotalRows.length - 1 &&
                        styles.receiptTotalRowLast
                    ]}
                  >
                    <Text style={styles.receiptTotalLabel}>{row.label}</Text>
                    <Text
                      style={[
                        styles.receiptTotalValue,
                        row.isDiscount && styles.receiptTotalValueDiscount,
                        row.strong && styles.receiptTotalValueStrong
                      ]}
                    >
                      {row.value}
                    </Text>
                  </View>
                ))}
              </View>

              <View style={styles.tallyGrid}>
                <View style={styles.tallyItem}>
                  <Text style={styles.tallyLabel}>Everything</Text>
                  <Text style={styles.tallyValue}>
                    {formatMoney(totals.grandTotal)}
                  </Text>
                </View>
                <View style={styles.tallyItem}>
                  <Text style={styles.tallyLabel}>Amount of people</Text>
                  <Text style={styles.tallyValue}>{bill.people.length}</Text>
                </View>
              </View>
            </Section>

            <Section title="Payer">
              {bill.people.length === 0 ? (
                <EmptyState label="No payer yet" />
              ) : (
                <>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={styles.payerList}>
                      {bill.people.map((person, index) => {
                        const selected = person.id === getPayerId(bill);
                        return (
                          <Pressable
                            key={person.id}
                            onPress={() => updatePayer(person.id)}
                            style={[
                              styles.payerChip,
                              selected && styles.payerChipSelected
                            ]}
                          >
                            <Text
                              style={[
                                styles.payerChipText,
                                selected && styles.payerChipTextSelected
                              ]}
                            >
                              {personName(person, index)}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </ScrollView>

                  <View style={styles.paymentList}>
                    {bill.people.map((person, index) => {
                      const payerLabel = payer
                        ? personName(
                          payer,
                          bill.people.findIndex((item) => item.id === payer.id)
                        )
                        : "Payer";
                      const isPayer = person.id === getPayerId(bill);
                      const paid = isPersonPaidToPayer(bill, person.id);
                      return (
                        <View key={person.id} style={styles.paymentRow}>
                          <View style={styles.paymentTextBlock}>
                            <Text style={styles.paymentText}>
                              {personName(person, index)} -&gt; {payerLabel}
                            </Text>
                            <Text
                              style={[
                                styles.paymentStatusText,
                                paid && styles.paymentStatusTextPaid
                              ]}
                            >
                              {isPayer ? "Payer" : paid ? "Paid" : "Pending"}
                            </Text>
                          </View>
                          <Text style={styles.paymentAmount}>
                            {formatMoney(totals.net[person.id] ?? 0)}
                          </Text>
                          <Pressable
                            accessibilityLabel={`${personName(
                              person,
                              index
                            )} paid ${payerLabel}`}
                            accessibilityRole="checkbox"
                            accessibilityState={{
                              checked: paid,
                              disabled: isPayer
                            }}
                            disabled={isPayer}
                            hitSlop={6}
                            onPress={() => togglePaidPerson(person.id)}
                            style={[
                              styles.paidCheckbox,
                              paid && styles.paidCheckboxChecked,
                              isPayer && styles.paidCheckboxDisabled
                            ]}
                          >
                            {paid ? (
                              <View style={styles.paidCheckboxMark} />
                            ) : null}
                          </Pressable>
                        </View>
                      );
                    })}
                  </View>
                </>
              )}
            </Section>

            <Section title="Copy summary">
              <View style={styles.summaryTextBox}>
                <Text selectable style={styles.summaryText}>
                  {summaryText}
                </Text>
              </View>

              <View style={styles.actionRow}>
                <Pressable
                  onPress={() => copyText(summaryText)}
                  style={[
                    styles.primaryButton,
                    bill.people.length === 0 && styles.disabledButton
                  ]}
                  disabled={bill.people.length === 0}
                >
                  <Text
                    style={[
                      styles.primaryButtonText,
                      bill.people.length === 0 && styles.disabledButtonText
                    ]}
                  >
                    Copy text
                  </Text>
                </Pressable>
              </View>
            </Section>
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
      <Modal
        visible={Boolean(bill.receiptImage) && receiptPreviewOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setReceiptPreviewOpen(false)}
      >
        <View style={styles.receiptPhotoModalBackdrop}>
          <Pressable
            accessibilityLabel="Close receipt photo"
            onPress={() => setReceiptPreviewOpen(false)}
            style={styles.receiptPhotoModalClose}
          >
            <Text style={styles.receiptPhotoModalCloseText}>Close</Text>
          </Pressable>
          {bill.receiptImage ? (
            <Image
              source={{ uri: bill.receiptImage }}
              style={styles.receiptPhotoModalImage}
              resizeMode="contain"
            />
          ) : null}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

type SectionProps = {
  title: string;
  children: React.ReactNode;
  onAdd?: () => void;
  addLabel?: string;
};

function Section({ title, children, onAdd, addLabel }: SectionProps) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {onAdd ? (
          <Pressable onPress={onAdd} style={styles.addButton}>
            <Text style={styles.addButtonText}>+ {addLabel ?? "Add"}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

type AmountRowEditorProps = {
  labelValue: string;
  amountValue: string;
  amountLabel: string;
  onChangeLabel: (value: string) => void;
  onChangeAmount: (value: string) => void;
  onRemove: () => void;
  children: React.ReactNode;
};

function AmountRowEditor({
  labelValue,
  amountValue,
  amountLabel,
  onChangeLabel,
  onChangeAmount,
  onRemove,
  children
}: AmountRowEditorProps) {
  return (
    <View style={styles.rowBlock}>
      <View style={styles.rowHeader}>
        <TextInput
          value={labelValue}
          onChangeText={onChangeLabel}
          style={styles.labelInput}
          placeholder="Label"
          placeholderTextColor="#94a3b8"
        />
        <Pressable onPress={onRemove} style={styles.removeButton}>
          <Text style={styles.removeButtonText}>x</Text>
        </Pressable>
      </View>
      <View style={styles.compactFields}>
        <View style={styles.compactField}>
          <Text style={styles.inputLabel}>{amountLabel}</Text>
          <AmountInput
            value={amountValue}
            onChangeText={onChangeAmount}
            placeholder="0.00"
          />
        </View>
      </View>
      {children}
    </View>
  );
}

type PercentRowEditorProps = {
  labelValue: string;
  percentValue: string;
  onChangeLabel: (value: string) => void;
  onChangePercent: (value: string) => void;
  onRemove: () => void;
  children: React.ReactNode;
};

function PercentRowEditor({
  labelValue,
  percentValue,
  onChangeLabel,
  onChangePercent,
  onRemove,
  children
}: PercentRowEditorProps) {
  return (
    <View style={styles.rowBlock}>
      <View style={styles.rowHeader}>
        <TextInput
          value={labelValue}
          onChangeText={onChangeLabel}
          style={styles.labelInput}
          placeholder="Label"
          placeholderTextColor="#94a3b8"
        />
        <Pressable onPress={onRemove} style={styles.removeButton}>
          <Text style={styles.removeButtonText}>x</Text>
        </Pressable>
      </View>
      <View style={styles.compactFields}>
        <View style={styles.compactField}>
          <Text style={styles.inputLabel}>Percent</Text>
          <AmountInput
            value={percentValue}
            onChangeText={onChangePercent}
            placeholder="0"
            suffix="%"
          />
        </View>
      </View>
      {children}
    </View>
  );
}

type AmountInputProps = {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  suffix?: string;
};

function AmountInput({
  value,
  onChangeText,
  placeholder,
  suffix
}: AmountInputProps) {
  return (
    <View style={styles.amountInputWrap}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType="default"
        placeholder={placeholder}
        style={styles.amountInput}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor="#94a3b8"
      />
      {suffix ? <Text style={styles.inputSuffix}>{suffix}</Text> : null}
    </View>
  );
}

type PersonValueStripProps = {
  people: Person[];
  values: Record<string, number>;
  isDiscount?: boolean;
};

function PersonValueStrip({
  people,
  values,
  isDiscount = false
}: PersonValueStripProps) {
  const responsiveCellWidth = useResponsiveCellWidth();

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.strip}>
        {people.map((person, index) => (
          <View
            key={person.id}
            style={[styles.valueCell, { width: responsiveCellWidth }]}
          >
            <Text numberOfLines={1} style={styles.cellName}>
              {personName(person, index)}
            </Text>
            <Text
              style={[
                styles.cellValue,
                isDiscount && styles.discountValue
              ]}
            >
              {isDiscount && Math.abs(values[person.id] ?? 0) >= 0.005
                ? "-"
                : ""}
              {formatCell(values[person.id] ?? 0)}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

type SummaryStripProps = {
  title: string;
  people: Person[];
  values: Record<string, number>;
  strong?: boolean;
  isDiscount?: boolean;
};

function SummaryStrip({
  title,
  people,
  values,
  strong = false,
  isDiscount = false
}: SummaryStripProps) {
  const responsiveCellWidth = useResponsiveCellWidth();

  return (
    <View style={styles.summaryBlock}>
      <Text style={styles.summaryTitle}>{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.strip}>
          {people.map((person, index) => (
            <View
              key={person.id}
              style={[
                styles.valueCell,
                { width: responsiveCellWidth },
                strong && styles.netCell
              ]}
            >
              <Text numberOfLines={1} style={styles.cellName}>
                {personName(person, index)}
              </Text>
              <Text
                style={[
                  styles.cellValue,
                  strong && styles.netValue,
                  isDiscount && styles.discountValue
                ]}
              >
                {isDiscount && Math.abs(values[person.id] ?? 0) >= 0.005
                  ? "-"
                  : ""}
                {formatCell(values[person.id] ?? 0)}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyStateText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    width: "100%",
    backgroundColor: "#f8fafc"
  },
  keyboardArea: {
    flex: 1
  },
  screenShell: {
    flex: 1,
    width: "100%"
  },
  content: {
    flexGrow: 1,
    width: "100%",
    padding: 16,
    paddingBottom: 40,
    gap: 14
  },
  homeHero: {
    gap: 16,
    paddingTop: 8,
    paddingBottom: 6
  },
  homeTitleBlock: {
    gap: 2
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    flexWrap: "nowrap",
    gap: 12,
    paddingTop: 8,
    paddingBottom: 8,
    backgroundColor: "#f8fafc",
    zIndex: 10,
    elevation: 2
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff"
  },
  screenTitleBlock: {
    flex: 1,
    minWidth: 0
  },
  backButtonText: {
    color: "#0f172a",
    fontSize: 24,
    lineHeight: 28,
    fontWeight: "900"
  },
  kicker: {
    color: "#0f766e",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  title: {
    flexShrink: 1,
    color: "#0f172a",
    fontSize: 29,
    lineHeight: 35,
    fontWeight: "800"
  },
  primaryButton: {
    minHeight: 44,
    borderRadius: 8,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
    backgroundColor: "#0f766e"
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800"
  },
  outlineButton: {
    minHeight: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#99f6e4",
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 1,
    backgroundColor: "#ffffff"
  },
  outlineButtonText: {
    color: "#0f766e",
    fontSize: 13,
    fontWeight: "800"
  },
  dangerButton: {
    minHeight: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#fecaca",
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 1,
    backgroundColor: "#fff1f2"
  },
  dangerButtonText: {
    color: "#be123c",
    fontSize: 13,
    fontWeight: "800"
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    width: "100%"
  },
  formStack: {
    gap: 10
  },
  section: {
    width: "100%",
    backgroundColor: "#ffffff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d9e2ec",
    padding: 12,
    gap: 12
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 12
  },
  sectionTitle: {
    flex: 1,
    minWidth: 0,
    color: "#0f172a",
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "800"
  },
  addButton: {
    minHeight: 36,
    borderRadius: 8,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    backgroundColor: "#ccfbf1"
  },
  addButtonText: {
    color: "#0f766e",
    fontSize: 13,
    fontWeight: "800"
  },
  historyList: {
    gap: 10
  },
  groupShortcutList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  groupShortcut: {
    minWidth: 138,
    flexGrow: 1,
    flexBasis: 138,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#99f6e4",
    backgroundColor: "#f0fdfa",
    padding: 10,
    gap: 4
  },
  groupShortcutTitle: {
    color: "#0f172a",
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "900"
  },
  groupShortcutMeta: {
    color: "#0f766e",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800"
  },
  savedGroupList: {
    gap: 10
  },
  savedGroupItem: {
    width: "100%",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d9e2ec",
    backgroundColor: "#f8fafc",
    padding: 10,
    gap: 10
  },
  historyItem: {
    width: "100%",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d9e2ec",
    backgroundColor: "#f8fafc",
    padding: 10,
    gap: 10
  },
  historyItemSelected: {
    borderColor: "#0f766e",
    backgroundColor: "#ecfeff"
  },
  selectionBar: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#99f6e4",
    backgroundColor: "#f0fdfa",
    padding: 10,
    gap: 10
  },
  selectionText: {
    color: "#0f766e",
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "900"
  },
  selectedButton: {
    borderColor: "#0f766e",
    backgroundColor: "#0f766e"
  },
  selectedButtonText: {
    color: "#ffffff"
  },
  historyHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 10
  },
  historyTitleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 4
  },
  historyTitle: {
    color: "#0f172a",
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "900"
  },
  historyMeta: {
    color: "#64748b",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700"
  },
  historyTotal: {
    color: "#0f766e",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
    flexShrink: 0,
    textAlign: "right"
  },
  historySummary: {
    color: "#334155",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600"
  },
  billNameInput: {
    width: "100%",
    minHeight: 50,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    color: "#0f172a",
    paddingHorizontal: 12,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "900"
  },
  receiptPhotoEmpty: {
    minHeight: 92,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#99f6e4",
    backgroundColor: "#f0fdfa",
    padding: 12,
    justifyContent: "center",
    gap: 6
  },
  receiptPhotoEmptyTitle: {
    color: "#0f766e",
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "900"
  },
  receiptPhotoEmptyText: {
    color: "#475569",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700"
  },
  receiptPhotoBanner: {
    minHeight: 112,
    maxHeight: 150,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d9e2ec",
    backgroundColor: "#f8fafc",
    overflow: "hidden"
  },
  receiptPhotoImage: {
    width: "100%",
    height: 132
  },
  receiptPhotoOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: 10,
    backgroundColor: "rgba(15, 23, 42, 0.72)"
  },
  receiptPhotoOverlayText: {
    color: "#ffffff",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "900"
  },
  receiptPhotoModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.94)",
    padding: 16,
    justifyContent: "center"
  },
  receiptPhotoModalImage: {
    width: "100%",
    height: "82%"
  },
  receiptPhotoModalClose: {
    position: "absolute",
    top: 18,
    right: 16,
    zIndex: 2,
    minHeight: 42,
    borderRadius: 8,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff"
  },
  receiptPhotoModalCloseText: {
    color: "#0f172a",
    fontSize: 14,
    fontWeight: "900"
  },
  personList: {
    flexDirection: "row",
    gap: 10
  },
  personEditor: {
    width: 154,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d9e2ec",
    backgroundColor: "#f8fafc",
    padding: 10,
    gap: 8
  },
  inputLabel: {
    color: "#475569",
    fontSize: 12,
    fontWeight: "700"
  },
  nameInput: {
    minWidth: 0,
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    color: "#0f172a",
    paddingHorizontal: 10,
    fontSize: 15,
    fontWeight: "700"
  },
  multilineInput: {
    minWidth: 0,
    minHeight: 82,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    color: "#0f172a",
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: "700",
    textAlignVertical: "top"
  },
  amountInputWrap: {
    minWidth: 0,
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    paddingHorizontal: 10
  },
  amountInput: {
    flex: 1,
    minWidth: 0,
    color: "#0f172a",
    fontSize: 16,
    fontWeight: "700",
    paddingVertical: 8
  },
  inputSuffix: {
    color: "#64748b",
    fontSize: 14,
    fontWeight: "800",
    marginLeft: 8
  },
  miniButton: {
    minHeight: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#fecaca",
    backgroundColor: "#fff1f2",
    alignItems: "center",
    justifyContent: "center"
  },
  miniButtonText: {
    color: "#be123c",
    fontSize: 13,
    fontWeight: "800"
  },
  disabledButton: {
    borderColor: "#e2e8f0",
    backgroundColor: "#f1f5f9"
  },
  disabledButtonText: {
    color: "#94a3b8"
  },
  rowBlock: {
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 12,
    gap: 10
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    gap: 8
  },
  labelInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    color: "#0f172a",
    paddingHorizontal: 10,
    fontSize: 15,
    fontWeight: "700"
  },
  removeButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fee2e2"
  },
  removeButtonText: {
    color: "#991b1b",
    fontSize: 19,
    fontWeight: "900",
    lineHeight: 22
  },
  compactFields: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  compactField: {
    flex: 1,
    minWidth: 120,
    gap: 6
  },
  stripLabel: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  strip: {
    flexDirection: "row",
    gap: 8
  },
  cell: {
    width: maxCellWidth,
    minHeight: 74,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d9e2ec",
    backgroundColor: "#f8fafc",
    padding: 8,
    gap: 6
  },
  valueCell: {
    width: maxCellWidth,
    minHeight: 64,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d9e2ec",
    backgroundColor: "#f8fafc",
    padding: 8,
    justifyContent: "space-between"
  },
  netCell: {
    borderColor: "#14b8a6",
    backgroundColor: "#ecfeff"
  },
  cellName: {
    color: "#64748b",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800"
  },
  cellInput: {
    minWidth: 0,
    minHeight: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    color: "#0f172a",
    paddingHorizontal: 8,
    fontSize: 15,
    fontWeight: "800"
  },
  cellValue: {
    color: "#0f172a",
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "900"
  },
  netValue: {
    color: "#0f766e"
  },
  discountValue: {
    color: "#be123c"
  },
  summaryBlock: {
    gap: 8
  },
  summaryTitle: {
    color: "#334155",
    fontSize: 14,
    fontWeight: "800"
  },
  summaryTextBox: {
    width: "100%",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d9e2ec",
    backgroundColor: "#f8fafc",
    padding: 10
  },
  summaryText: {
    color: "#0f172a",
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "700"
  },
  receiptTotalsList: {
    width: "100%",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d9e2ec",
    backgroundColor: "#ffffff",
    overflow: "hidden"
  },
  receiptTotalRow: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0"
  },
  receiptTotalRowLast: {
    borderBottomWidth: 0
  },
  receiptTotalLabel: {
    flex: 1,
    minWidth: 0,
    color: "#475569",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800"
  },
  receiptTotalValue: {
    color: "#0f172a",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
    flexShrink: 0,
    textAlign: "right"
  },
  receiptTotalValueDiscount: {
    color: "#be123c"
  },
  receiptTotalValueStrong: {
    color: "#0f766e"
  },
  tallyGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  tallyItem: {
    flex: 1,
    minWidth: 132,
    minHeight: 78,
    borderRadius: 8,
    backgroundColor: "#0f172a",
    padding: 12,
    justifyContent: "space-between"
  },
  tallyLabel: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  tallyValue: {
    color: "#ffffff",
    fontSize: 21,
    lineHeight: 26,
    fontWeight: "900"
  },
  payerList: {
    flexDirection: "row",
    gap: 8
  },
  payerChip: {
    minHeight: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center"
  },
  payerChipSelected: {
    borderColor: "#0f766e",
    backgroundColor: "#ccfbf1"
  },
  payerChipText: {
    color: "#334155",
    fontSize: 14,
    fontWeight: "800"
  },
  payerChipTextSelected: {
    color: "#0f766e"
  },
  paymentList: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d9e2ec",
    overflow: "hidden"
  },
  paymentRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0"
  },
  paymentTextBlock: {
    flex: 1,
    minWidth: 0,
    gap: 3
  },
  paymentText: {
    color: "#0f172a",
    fontSize: 14,
    fontWeight: "700"
  },
  paymentStatusText: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  paymentStatusTextPaid: {
    color: "#0f766e"
  },
  paymentAmount: {
    color: "#0f766e",
    fontSize: 14,
    fontWeight: "900",
    minWidth: 82,
    textAlign: "right",
    flexShrink: 0
  },
  paidCheckbox: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#94a3b8",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0
  },
  paidCheckboxChecked: {
    borderColor: "#0f766e",
    backgroundColor: "#0f766e"
  },
  paidCheckboxDisabled: {
    borderColor: "#cbd5e1",
    backgroundColor: "#f8fafc"
  },
  paidCheckboxMark: {
    width: 7,
    height: 13,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderColor: "#ffffff",
    marginTop: -2,
    transform: [{ rotate: "45deg" }]
  },
  emptyState: {
    minHeight: 58,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0"
  },
  emptyStateText: {
    color: "#64748b",
    fontSize: 14,
    fontWeight: "700"
  }
});
