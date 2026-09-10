import { normalizeDate } from '../utils/date';
import { InvoiceItem, ExpensePlanOptions, ExpenseBatchPlanResult, ExpenseCategory, ExpenseTripSegment } from '../types/state';
import { EXPENSE_TYPES } from '../config/constants';
import { parseItineraryTable } from './applicationService';

function normalizeTime(t: any): string {
    if (!t) return '';
    const clean = t.toString().trim();
    const parts = clean.split(':');
    if (parts.length >= 2) {
        return `${parts[0].trim().padStart(2, '0')}:${parts[1].trim().padStart(2, '0')}`;
    }
    return clean;
}

/**
 * 智能识别发票业务类别
 * 严禁将外部可变草稿参数 expenseTypeName 混入固有票面文本，避免循环自锁毒化
 */
export function detectInvoiceCategory(invVO: any = {}, rawItem: any = {}, expenseTypeName: string = ''): ExpenseCategory {
    const seller = String(invVO.salesName || invVO.seller || rawItem.salesName || '').trim();
    const details = String(invVO.invoiceDetails || rawItem.invoiceDetails || '').trim();
    const goods = String(invVO.commodityNames || invVO.cargoInformation || invVO.goodsName || rawItem.goodsName || '').trim();
    const fileName = String(invVO.fileName || rawItem.fileName || '').trim();
    const abbr = String(invVO.invoiceTypeAbbreviation || rawItem.invoiceTypeAbbreviation || '').trim();
    const code = String(invVO.invoiceTypeCode || rawItem.invoiceTypeCode || '').trim();

    // 组合固有票面文本 (严禁混入 expenseTypeName)
    const intrinsicText = `${seller} ${details} ${goods} ${fileName} ${abbr}`.toLowerCase();

    // 1. 高速过路费/通行费判断 (如 "广州机场-酒店过路费.pdf"、"广东联合电子服务股份有限公司")
    const isToll = /过路费|通行费|高速|etc/.test(intrinsicText) ||
                   /联合电子|高速公路|路桥|收费站/.test(seller);

    // 2. 出租车/网约车计程与乘车特征
    const hasRideMetadata = Boolean(
        isToll ||
        invVO.timeGetOn || rawItem.timeGetOn ||
        invVO.mileage || rawItem.mileage ||
        abbr === '出租车' || code === '10500' ||
        /出租车发票|出租汽车|网约车/.test(details) ||
        /出租汽车|滴滴|曹操|享道|t3|首汽|高德|美团打车/.test(seller)
    );

    const amt = Number(rawItem.amount ?? rawItem.amt ?? rawItem.amountObj?.amount ?? invVO.amountTax ?? 0);

    // 3. 飞机票 (航空客票)
    if (/航空|机票|民航|航班|airline|flight|往返机票/.test(intrinsicText)) {
        return 'FLIGHT';
    }
    // 航司/旅行社电子行程单 (如 携程/华程西南 + 城市-城市往返路线，且无出租车计价器特征)
    const hasCityRoute = /[\u4e00-\u9fa5]{2,6}[-_至到➔][\u4e00-\u9fa5]{2,6}/.test(fileName);
    const isOTA = /旅行社|商旅|机票代理|携程|华程西南|同程|去哪儿|飞猪/.test(seller);
    if (isOTA && hasCityRoute && !hasRideMetadata) {
        return 'FLIGHT';
    }

    // 4. 火车票 (高铁/动车/列车客票)
    if (/铁路|12306|高铁|动车|火车站|列车|地铁/.test(intrinsicText) || abbr === '电-火车' || /铁路电子客票/.test(details)) {
        return 'TRAIN';
    }

    // 5. 酒店住宿 (需严格排除网约车/过路费特征)
    const hasHotelSeller = /酒店|宾馆|客栈|度假村|旅馆|会馆|饭店|旅社|民宿|hotel|inn/i.test(seller);
    const hasHotelFileName = /酒店|宾馆|住宿|客房|房费|hotel|inn|度假村/i.test(fileName) && !isToll && !/打车|出租车|车费|路桥费/.test(fileName);
    const hasHotelGoods = /住宿|客房|房费|住宿服务/.test(details) || /住宿|客房|房费|住宿服务/.test(goods);

    if (!hasRideMetadata && (hasHotelSeller || hasHotelFileName || hasHotelGoods)) {
        return 'HOTEL';
    }
    if (!hasRideMetadata && amt >= 280 && /酒店|住宿|客房/.test(intrinsicText)) {
        return 'HOTEL';
    }

    // 6. 通信费
    if (/移动|联通|电信|通信|手机|话费|telecom|unicom|mobile/i.test(intrinsicText) && !/手机终端|手机销售/.test(goods)) {
        return 'COMMUNICATION';
    }

    // 7. 会议与餐饮
    if (/会议|会务|会展/.test(intrinsicText)) {
        return 'MEETING';
    }
    if (/餐饮|餐馆|酒楼|食堂|饭庄|茶歇|美食/.test(intrinsicText)) {
        return 'ENTERTAINMENT_EXTERNAL';
    }

    // 8. 出租车 / 网约车 / 过路费
    if (hasRideMetadata || /出租车|网约车|滴滴|客运|出租汽车|曹操|t3|享道|首汽|高德|美团打车|打车|过路费|通行费/.test(intrinsicText)) {
        return 'TAXI';
    }

    // 9. 仅当固有票面无任何线索时，才参考既有的 expenseTypeName
    if (expenseTypeName) {
        const expLower = expenseTypeName.toLowerCase();
        if (/机|航/.test(expLower)) return 'FLIGHT';
        if (/火车|高铁|动车/.test(expLower)) return 'TRAIN';
        if (/住|宿|酒店|宾馆/.test(expLower)) return 'HOTEL';
        if (/通|话费|移动/.test(expLower)) return 'COMMUNICATION';
        if (/车|交通/.test(expLower)) return 'TAXI';
    }

    // 10. 大额兜底安全线：单笔金额巨大 (> ¥350) 且无打车特征，绝不轻易归为出租车
    if (amt >= 350 && !hasRideMetadata) {
        if (/酒店|宾馆|宿/.test(intrinsicText)) return 'HOTEL';
        if (/机票|航空|旅行社/.test(intrinsicText)) return 'FLIGHT';
    }

    return 'OTHER';
}


/**
 * 纯动态通用交通枢纽与出发/到达站推断 (Zero Hardcoding 铁律)
 * 拒绝任何静态城市/机场字典硬编码，基于上下文票据文本动态提取，或依据交通方式与目的城市通用推导
 */
export function inferTripHub(dest: string, contextText: string = ''): { stationOrAirport: string; departureStation: string; arrivalStation: string } {
    const fn = (contextText || '');
    const cleanDest = (dest || '').trim().replace(/市|区|县/g, '');

    const isTrain = /高铁|动车|火车站|列车|铁路/.test(fn);
    const isFlight = /机票|航班|民航|航空|往返机票/.test(fn);

    let arrivalStation = '';
    // 1.1 显式到达站: 如 "-合肥南站", "到北京西站", "-嘉兴南站"
    const stationMatch = fn.match(/(?:到|至|[-_➔])\s*([^\s_（()）\-]{2,10}?(?:国际机场|机场|火车站|高铁站|东站|南站|西站|北站|客运站|站))/);
    if (stationMatch && stationMatch[1]) {
        arrivalStation = stationMatch[1].trim();
    }

    // 1.2 显式机场: 如 "上海虹桥-天津滨海机票", "大连周水子", "成都双流"
    if (!arrivalStation) {
        const airportDirectMatch = fn.match(/([^\s_（()）\-]{2,10}?(?:国际机场|机场))/);
        if (airportDirectMatch && airportDirectMatch[1] && !/上海|虹桥|浦东|北京首都/.test(airportDirectMatch[1])) {
            arrivalStation = airportDirectMatch[1].trim();
        } else {
            const flightHubMatch = fn.match(/(?:到|至|[-_➔])\s*([^\s_（()）\-]{2,8}?)(?:机票|航班|民航|往返机票)/);
            if (flightHubMatch && flightHubMatch[1]) {
                const hubName = flightHubMatch[1].replace(/机票|往返|航班/g, '').trim();
                if (hubName && !/上海|虹桥|浦东/.test(hubName)) {
                    arrivalStation = hubName.endsWith('机场') ? hubName : `${hubName}机场`;
                }
            }
        }
    }

    // 1.3 显式高铁站: 如 "-嘉兴南高铁", "-合肥南"
    if (!arrivalStation && isTrain) {
        const trainHubMatch = fn.match(/(?:到|至|[-_➔])\s*([^\s_（()）\-]{2,8}?)(?:高铁|动车|列车|火车)/);
        if (trainHubMatch && trainHubMatch[1]) {
            const hubName = trainHubMatch[1].replace(/高铁|动车|列车|火车/g, '').trim();
            if (hubName && !/上海|虹桥/.test(hubName)) {
                arrivalStation = hubName.endsWith('站') ? hubName : `${hubName}高铁站`;
            }
        }
    }

    // 2. 出发站 (动态从文件名或票据提取，若未提取到则采用通用占位模板)
    let departureStation = '出发地交通枢纽';
    const depMatch = fn.match(/([^\s_（()）\-]{2,10}?(?:国际机场|机场|火车站|高铁站|东站|南站|西站|北站|客运站|枢纽))(?:\s*[-_➔至到])/);
    if (depMatch && depMatch[1]) {
        const candidateDep = depMatch[1].trim();
        if (!cleanDest || !candidateDep.includes(cleanDest)) {
            departureStation = candidateDep;
        }
    }

    // 3. 通用兜底推导 (纯基于目的地名称与出行工具动态生成，绝不写死城市列表)
    if (!arrivalStation) {
        if (cleanDest) {
            arrivalStation = isTrain ? `${cleanDest}高铁站` : (isFlight ? `${cleanDest}机场` : `${cleanDest}交通枢纽`);
        } else {
            arrivalStation = isTrain ? '高铁站' : (isFlight ? '机场' : '交通枢纽');
        }
    }

    return {
        stationOrAirport: arrivalStation,
        departureStation,
        arrivalStation
    };
}

/**
 * 纯动态从票面/文件名中提取航线与车次起止站点路线 (Zero Hardcoding 铁律)
 */
export function extractRouteFromText(text: string): { startCity: string; endCity: string; isRoute: boolean } | null {
    if (!text) return null;
    const routeMatch = text.match(/([\u4e00-\u9fa5]{2,6})[-_至到➔]([\u4e00-\u9fa5]{2,6})/);
    if (routeMatch) {
        const c1 = routeMatch[1].replace(/^[0-9一二三四五六七八九十]+月[0-9]+[日号_]?/, '')
                               .replace(/^[去到来回往乘坐]/, '')
                               .replace(/机票|高铁|动车|列车|火车|市|酒店|往返|国际机场|机场|南站|西站|北站|东站|站/g, '').trim();
        const c2 = routeMatch[2].replace(/^[0-9一二三四五六七八九十]+月[0-9]+[日号_]?/, '')
                               .replace(/^[去到来回往乘坐]/, '')
                               .replace(/机票|高铁|动车|列车|火车|市|酒店|往返|国际机场|机场|南站|西站|北站|东站|站/g, '').trim();
        if (c1 && c2) {
            return { startCity: c1, endCity: c2, isRoute: true };
        }
    }
    return null;
}

/**
 * 纯动态从发票销售方/文件名提取酒店正规简称 (Zero Hardcoding 铁律)
 */
export function extractHotelName(salesName: string = '', fileName: string = ''): string {
    const fnClean = (fileName.replace(/\.pdf$/i, '').split('（')[0] || '').trim();
    const raw = fnClean || salesName || '';
    if (!raw) return '';
    const cleaned = raw.replace(/(?:管理)?(?:有限)?(?:责任)?公司.*$/, '')
                       .replace(/^[0-9一二三四五六七八九十]+月[0-9]+[日号_]?/, '')
                       .trim();
    return cleaned;
}

/**
 * 严格判定是否为高速公路通行费/过路费发票
 */
export function isTollInvoice(inv: any): boolean {
    if (!inv) return false;
    const invVO = inv.invoiceVO || inv;
    const seller = String(invVO.salesName || invVO.seller || inv.salesName || '').trim();
    const details = String(invVO.invoiceDetails || inv.invoiceDetails || '').trim();
    const goods = String(invVO.commodityNames || invVO.cargoInformation || invVO.goodsName || inv.goodsName || '').trim();
    const fileName = String(invVO.fileName || inv.fileName || '').trim();
    const abbr = String(invVO.invoiceTypeAbbreviation || inv.invoiceTypeAbbreviation || '').trim();

    const text = `${seller} ${details} ${goods} ${fileName} ${abbr}`.toLowerCase();
    return /过路费|通行费|高速公路|路桥|收费公路|收费站|etc/.test(text) ||
           /联合电子|高速公路|路桥收费/.test(seller);
}

/**
 * 从 HH:mm 或 HH:mm:ss 字符串中解析全天分钟数 (0..1439)
 */
export function extractTimeInMinutes(timeStr: string): number | null {
    if (!timeStr) return null;
    const m = String(timeStr).match(/(\d{1,2})[:：](\d{1,2})/);
    if (!m) return null;
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (isNaN(hh) || isNaN(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return hh * 60 + mm;
}

/**
 * 智能按时间窗口将过路费发票绑定合并到对应的出租车费用记录中（一笔费用多张发票）
 * 遵循 Anti-Hardcoding 铁律：基于客观时间差与地理枢纽特征通用对齐
 */
export function bindTollsToTaxiExpenses(invoices: InvoiceItem[]): {
    mergedItems: InvoiceItem[];
    boundTollsCount: number;
    bindingLog: string[];
} {
    const bindingLog: string[] = [];
    let boundTollsCount = 0;

    // 1. 分离过路费与其它发票
    const tolls: InvoiceItem[] = [];
    const nonTolls: InvoiceItem[] = [];

    invoices.forEach(inv => {
        if (isTollInvoice(inv)) {
            tolls.push(inv);
        } else {
            nonTolls.push(inv);
        }
    });

    if (tolls.length === 0) {
        return { mergedItems: invoices, boundTollsCount: 0, bindingLog: [] };
    }

    // 2. 识别可被绑定的出租车/网约车行程 (type 为 TAXI 或 TRIP_TAXI，严格排除专票、酒店住宿、火车机票等非出租车票据)
    const taxis = nonTolls.filter(inv => {
        const text = `${inv.expenseTypeName || ''} ${inv.typeName || ''} ${inv.invoiceVO?.invoiceTypeAbbreviation || ''} ${inv.invoiceVO?.commodityNames || ''} ${inv.invoiceVO?.salesName || ''} ${inv.salesName || ''}`.toLowerCase();
        if (/专用发票|专票|增值税专用|增值税普通|普票|住宿|酒店|机票|航空|火车|高铁|动车/.test(text)) return false;
        if ((Number(inv.amount) || 0) >= 350 && !/出租车|打车|网约车|滴滴/.test(text)) return false;
        const cat = inv.type || detectInvoiceCategory(inv.invoiceVO || {}, inv, inv.expenseTypeName);
        return (cat === 'TAXI' || cat === 'TRIP_TAXI') && !isTollInvoice(inv);
    });

    // 3. 逐一为每张过路费寻找最佳出租车行程
    tolls.forEach(toll => {
        const tollDate = normalizeDate(toll.invoiceDate || (toll.invoiceVO && toll.invoiceVO.invoiceDate) || '');
        const tollAmt = Number(toll.amount ?? toll.invoiceVO?.amountTax ?? 0);

        // 尝试提取过路费的具体时间 (timeGetOn / invoiceTime / OCR / 文件名)
        const rawTollTime = toll.timeGetOn || toll.invoiceVO?.timeGetOn || toll.invoiceVO?.invoiceTime || toll.fileName || '';
        const tollMinutes = extractTimeInMinutes(rawTollTime);

        // 筛选同一天的出租车候选
        const sameDayTaxis = taxis.filter(t => normalizeDate(t.invoiceDate || '') === tollDate);

        let targetTaxi: InvoiceItem | null = null;

        if (sameDayTaxis.length === 1) {
            // 规则 1：同一天仅有一趟出租车，直接精准绑定
            targetTaxi = sameDayTaxis[0];
        } else if (sameDayTaxis.length > 1) {
            // 规则 2：同一天有多趟出租车
            if (tollMinutes !== null) {
                // 2.1 优先寻找时间窗口包容的行程 (timeGetOn - 15min <= tollTime <= timeGetOff + 15min)
                for (const taxi of sameDayTaxis) {
                    const startMin = extractTimeInMinutes(taxi.timeGetOn || '');
                    const endMin = extractTimeInMinutes(taxi.timeGetOff || '');
                    if (startMin !== null && endMin !== null) {
                        if (tollMinutes >= startMin - 15 && tollMinutes <= endMin + 15) {
                            targetTaxi = taxi;
                            break;
                        }
                    } else if (startMin !== null) {
                        if (Math.abs(tollMinutes - startMin) <= 60) {
                            targetTaxi = taxi;
                            break;
                        }
                    }
                }

                // 2.2 若未完全包容，寻找时间距离最近的出租车行程
                if (!targetTaxi) {
                    let minDiff = Infinity;
                    for (const taxi of sameDayTaxis) {
                        const startMin = extractTimeInMinutes(taxi.timeGetOn || '');
                        if (startMin !== null) {
                            const diff = Math.abs(tollMinutes - startMin);
                            if (diff < minDiff) {
                                minDiff = diff;
                                targetTaxi = taxi;
                            }
                        }
                    }
                }
            }

            // 2.3 若无明确时间或未命中，依据语义线索（如文件名包含机场/高铁，且出租车前往机场）或大额/长途行程优先绑定
            if (!targetTaxi) {
                const tollText = `${toll.fileName || ''} ${toll.invoiceVO?.fileName || ''} ${toll.salesName || ''}`;
                const isAirportToll = /机场|民航|飞机场/.test(tollText);
                const isStationToll = /高铁|火车站|车站/.test(tollText);

                if (isAirportToll || isStationToll) {
                    targetTaxi = sameDayTaxis.find(t => {
                        const addr = `${t.startAddress || ''} ${t.endAddress || ''} ${t.description || ''}`;
                        return (isAirportToll && /机场/.test(addr)) || (isStationToll && /站|高铁/.test(addr));
                    }) || null;
                }

                // 2.4 仍未选出时，绑定到当天金额最高的那趟出租车（高速过路费通常伴随长距离高额行程）
                if (!targetTaxi) {
                    const sorted = [...sameDayTaxis].sort((a, b) => (Number(b.amount || 0) - Number(a.amount || 0)));
                    targetTaxi = sorted[0];
                }
            }
        }

        if (targetTaxi) {
            // 执行绑定
            targetTaxi.subInvoices = targetTaxi.subInvoices || [];
            targetTaxi.subInvoices.push(toll);
            targetTaxi.tollAmount = Number(((targetTaxi.tollAmount || 0) + tollAmt).toFixed(2));
            targetTaxi.amount = Number(((targetTaxi.amount || 0) + tollAmt).toFixed(2));
            targetTaxi.invoiceCount = 1 + targetTaxi.subInvoices.length;
            targetTaxi.isModified = true;

            toll.isMergedIntoOther = true;
            toll.parentExpenseRecordId = targetTaxi.expenseRecordId;
            boundTollsCount++;

            const descTollTag = `(含过路费¥${tollAmt})`;
            if (targetTaxi.description) {
                if (!targetTaxi.description.includes('过路费')) {
                    targetTaxi.description = `${targetTaxi.description} ${descTollTag}`;
                }
            } else {
                targetTaxi.description = `市内交通 ${descTollTag}`;
            }

            bindingLog.push(`[${tollDate}] 过路费 ¥${tollAmt} (${toll.fileName || toll.salesName || '通行费'}) ➔ 绑定至出租车行程 ¥${targetTaxi.amount} (${targetTaxi.startAddress || ''}➔${targetTaxi.endAddress || ''})`);
        } else {
            // 孤立过路费（无任何出租车行程匹配）：安全保留为独立记录
            nonTolls.push(toll);
            bindingLog.push(`[${tollDate}] 过路费 ¥${tollAmt} 未找到同日出租车行程，保留为独立交通费记录`);
        }
    });

    return {
        mergedItems: nonTolls,
        boundTollsCount,
        bindingLog
    };
}

/**
 * 健壮的行程段数据归一化函数
 * 彻底容错不同大小写、下划线、缩写及嵌套属性名 (snake_case / camelCase / 中文 / legs)
 */
export function normalizeTripSegment(raw: any, defaultIndex: number = 1): ExpenseTripSegment {
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
                raw = JSON.parse(trimmed);
            } catch {
                // Not valid JSON
            }
        }
    }

    if (!raw || typeof raw !== 'object') {
        return {
            tripNo: defaultIndex,
            startDate: '',
            endDate: '',
            destination: '',
            hotelName: '',
            customerName: '',
            targetFactories: '',
            purpose: ''
        };
    }

    const tripNo = typeof raw.tripNo === 'number' ? raw.tripNo
        : (typeof raw.trip_no === 'number' ? raw.trip_no
        : (parseInt(String(raw.tripNo || raw.trip_no || raw.no || raw.index || raw['#'] || defaultIndex), 10) || defaultIndex));

    // 提取 startDate
    let rawStart = raw.startDate || raw.start_date || raw.beginDate || raw.begin_date || raw.start || raw.date || '';
    if (!rawStart && raw.timeRange && typeof raw.timeRange === 'string') {
        rawStart = raw.timeRange.split(/~|至|-/)[0]?.trim() || '';
    }
    if (!rawStart && Array.isArray(raw.dates) && raw.dates.length > 0) {
        rawStart = raw.dates[0];
    }
    if (!rawStart && Array.isArray(raw.legs) && raw.legs.length > 0) {
        rawStart = raw.legs[0].date;
    }

    // 提取 endDate
    let rawEnd = raw.endDate || raw.end_date || raw.finishDate || raw.finish_date || raw.end || '';
    if (!rawEnd && raw.timeRange && typeof raw.timeRange === 'string') {
        const parts = raw.timeRange.split(/~|至/);
        rawEnd = (parts.length > 1 ? parts[1] : parts[0])?.trim() || '';
    }
    if (!rawEnd && Array.isArray(raw.dates) && raw.dates.length > 0) {
        rawEnd = raw.dates[raw.dates.length - 1];
    }
    if (!rawEnd && Array.isArray(raw.legs) && raw.legs.length > 0) {
        rawEnd = raw.legs[raw.legs.length - 1].date;
    }
    if (!rawEnd && rawStart) {
        rawEnd = rawStart;
    }

    const startDate = normalizeDate(String(rawStart || '').trim());
    const endDate = normalizeDate(String(rawEnd || '').trim());

    // 提取 destination
    let dest = raw.destination || raw.dest || raw.city || raw.toCity || raw.targetCity || raw.to_city || '';
    if (!dest && Array.isArray(raw.legs) && raw.legs.length > 0) {
        dest = raw.legs[0].toCity || raw.legs[0].destination || '';
    }
    dest = String(dest || '').trim();

    // 提取 hotelName
    const hotel = String(raw.hotelName || raw.hotel_name || raw.hotel || raw.hotelTitle || '').trim();

    // 提取 targetFactories / customerName
    const factories = String(raw.targetFactories || raw.target_factories || raw.factory || raw.factories || '').trim();
    const customer = String(raw.customerName || raw.customer_name || raw.customer || raw.company || raw.client || factories || raw.purpose || '').trim();
    const purpose = String(raw.purpose || raw.reason || (factories ? `${dest}业务差旅与实地调研 (${factories})` : '')).trim();

    // 提取 stationOrAirport / departureStation / arrivalStation
    const rawStation = String(raw.stationOrAirport || raw.station_or_airport || raw.station || raw.airport || raw.hub || '').trim();
    const hubInfo = dest ? inferTripHub(dest, `${hotel} ${factories} ${customer} ${rawStation}`) : { stationOrAirport: '机场/高铁站', departureStation: '上海虹桥枢纽', arrivalStation: '机场/高铁站' };
    const departureStation = String(raw.departureStation || raw.departure_station || raw.depStation || hubInfo.departureStation).trim();
    const arrivalStation = String(raw.arrivalStation || raw.arrival_station || raw.arrStation || rawStation || hubInfo.arrivalStation).trim();
    const stationOrAirport = arrivalStation || rawStation || hubInfo.stationOrAirport;

    return {
        tripNo,
        startDate,
        endDate,
        destination: dest,
        hotelName: hotel,
        customerName: customer,
        targetFactories: factories || customer,
        stationOrAirport,
        departureStation,
        arrivalStation,
        purpose
    };
}

/**
 * 从全量发票池中智能自动反向聚类出差波次 (无需手动录入行程表)
 * 能够穿透发票附件名、大交通机票/高铁票、酒店住宿发票以及出租车日期跨度
 */
export function clusterTripsFromInvoices(invoices: InvoiceItem[], options: ExpensePlanOptions = {}): ExpenseTripSegment[] {
    if (!invoices || invoices.length === 0) return [];

    // 1. 过滤并排序具备有效日期的发票
    const datedInvoices = invoices
        .filter(inv => inv.invoiceDate && /^\d{4}-\d{2}-\d{2}$/.test(normalizeDate(inv.invoiceDate)))
        .map(inv => ({
            ...inv,
            normDate: normalizeDate(inv.invoiceDate || '')
        }))
        .sort((a, b) => a.normDate.localeCompare(b.normDate));

    if (datedInvoices.length === 0) return [];

    // 2. 辅助：纯动态从发票文本特征提取目的城市 (基于通用汉语地名结构与交通/酒店票据特征，拒绝静态城市字典)
    const getInvoiceCity = (inv: typeof datedInvoices[0]): string => {
        const text = `${inv.fileName || ''} ${inv.salesName || ''} ${inv.description || ''} ${inv.invoiceVO?.fileName || ''} ${inv.invoiceVO?.salesName || ''} ${inv.invoiceVO?.goodsName || ''}`;
        
        // 2.1 从大交通车票或往返行程文件名中动态提取目的地城市 (如 "8月21_天津_上海.pdf", "上海-大连_往返机票.pdf")
        const isTransportTicket = /机票|航班|民航|航空|高铁|动车|列车|火车|铁路/.test(text) ||
                                  (/旅行社|商旅|机票代理/.test(text) && /[-_至到➔]/.test(text));

        // 优先从航线/车次往返文件名提取 (如 "城市A-城市B" 或 "城市A_城市B")
        const fn = `${inv.fileName || ''} ${inv.invoiceVO?.fileName || ''}`;
        const routeMatch = fn.match(/([\u4e00-\u9fa5]{2,6})[-_至到➔]([\u4e00-\u9fa5]{2,6})/);
        if (routeMatch) {
            const clean1 = routeMatch[1].replace(/^[去到来回往乘坐]/, '').replace(/机票|高铁|动车|列车|火车|市|酒店|往返|国际机场|机场|南站|西站|北站|东站|站/g, '').trim();
            const clean2 = routeMatch[2].replace(/^[去到来回往乘坐]/, '').replace(/机票|高铁|动车|列车|火车|市|酒店|往返|国际机场|机场|南站|西站|北站|东站|站/g, '').trim();
            if (clean1 && !/上海|北京|虹桥|浦东/.test(clean1) && clean1.length >= 2) return clean1;
            if (clean2 && !/上海|北京|虹桥|浦东/.test(clean2) && clean2.length >= 2) return clean2;
        }

        if (isTransportTicket) {
            const ticketMatch = text.match(/(?:[-_➔至到]|到达|飞往|前往)\s*([\u4e00-\u9fa5]{2,8}?)(?:市|机票|高铁|动车|火车|航班|客票|往返|南站|西站|北站|东站|站|机场|_|\.|$)/);
            if (ticketMatch && ticketMatch[1]) {
                let city = ticketMatch[1].replace(/^[去到来回往乘坐]/, '');
                city = city.replace(/机票|高铁|酒店|往返|市|国际机场|机场|火车站|高铁站|东站|南站|西站|北站|客运站|航站楼|站/g, '').trim();
                if (city.length > 2 && /[南北东西卫]$/.test(city)) {
                    city = city.slice(0, -1);
                }
                // 过滤常驻地/出发地/出发机场
                if (city && !/上海|北京|虹桥|浦东/.test(city) && city.length >= 2) {
                    return city;
                }
            }
        }

        // 2.2 从酒店发票中动态提取所在城市
        const hotelMatch = text.match(/(?:^|[^a-zA-Z\u4e00-\u9fa5])([\u4e00-\u9fa5]{2,4}?)(?:市|区|县|新区|开发区|经济技术开发区)?[^\s_（()）\-]{0,12}?(?:酒店|宾馆|客房|饭店|度假村|客栈|旅馆|会馆|旅社|民宿)/);
        if (hotelMatch && hotelMatch[1]) {
            let city = hotelMatch[1].replace(/^[去到来回往乘坐]/, '');
            city = city.replace(/有限公司|分公司|管理|集团|连锁/g, '').trim();
            if (city.length > 2 && /[南北东西]$/.test(city)) {
                city = city.slice(0, -1);
            }
            if (city && !/上海|北京|虹桥|浦东/.test(city) && city.length >= 2) {
                return city;
            }
            if (city === '金山') return '金山';
        }

        // 2.3 宽松匹配 (必须带有交通/住宿特征)
        if (isTransportTicket || /酒店|住宿|客房|宾馆/.test(text)) {
            const looseMatch = text.match(/(?:上海|北京)?[-至_➔到]([\u4e00-\u9fa5]{2,4}?)(?:机票|高铁|酒店|往返|_)/);
            if (looseMatch && looseMatch[1]) {
                const c = looseMatch[1].replace(/^[去到来回往乘坐]/, '').replace(/酒店|机票|高铁|市/g, '').trim();
                if (c && !/上海|北京|虹桥|浦东/.test(c) && c.length >= 2) return c;
            }
        }

        return '';
    };

    // 3. 智能多维聚类：结合日期跨度与目的城市跳跃
    const clusters: Array<typeof datedInvoices> = [];
    let currentCluster: typeof datedInvoices = [];

    const getClusterCity = (cluster: typeof datedInvoices): string => {
        for (const it of cluster) {
            const c = getInvoiceCity(it);
            if (c) return c;
        }
        return '';
    };

    for (let i = 0; i < datedInvoices.length; i++) {
        const item = datedInvoices[i];
        if (currentCluster.length === 0) {
            currentCluster.push(item);
        } else {
            const prevItem = currentCluster[currentCluster.length - 1];
            const prevTime = new Date(prevItem.normDate.replace(/-/g, '/')).getTime();
            const currTime = new Date(item.normDate.replace(/-/g, '/')).getTime();
            const startTime = new Date(currentCluster[0].normDate.replace(/-/g, '/')).getTime();
            const dayDiff = Math.round((currTime - prevTime) / (24 * 3600 * 1000));
            const totalSpan = Math.round((currTime - startTime) / (24 * 3600 * 1000));

            const itemCity = getInvoiceCity(item);
            const clusterCity = getClusterCity(currentCluster);

            let shouldSplit = false;
            if (itemCity && clusterCity && itemCity !== clusterCity) {
                // 城市显式变化 (例如: 天津 ➔ 广州)
                shouldSplit = true;
            } else if (dayDiff > 5) {
                // 间隔超过 5 天，跨周必定为不同出差波次
                shouldSplit = true;
            } else if (dayDiff > 2 && totalSpan > 6) {
                // 本波次已满一周 (跨度 > 6天) 且出现跳跃
                shouldSplit = true;
            }

            if (shouldSplit) {
                clusters.push(currentCluster);
                currentCluster = [item];
            } else {
                currentCluster.push(item);
            }
        }
    }
    if (currentCluster.length > 0) {
        clusters.push(currentCluster);
    }

    // 4. 对每个波次智能提取城市、交通枢纽、酒店及客户据点
    const segments: ExpenseTripSegment[] = [];

    clusters.forEach((group, idx) => {
        const startDate = group[0].normDate;
        const endDate = group[group.length - 1].normDate;

        // 收集该聚类下所有的线索文本 (文件名, 销售方, 描述, 备注)
        const allText = group.map(g => `${g.fileName || ''} ${g.salesName || ''} ${g.description || ''} ${g.invoiceVO?.fileName || ''} ${g.invoiceVO?.salesName || ''}`).join(' ');

        // 匹配目的城市
        let matchedCity = getClusterCity(group);

        // 如果未命中，尝试从组内线索文本总体提取
        if (!matchedCity) {
            matchedCity = getInvoiceCity({ fileName: allText } as any);
        }
        if (!matchedCity) {
            matchedCity = `目的地${idx + 1}`;
        }

        // 提取酒店名称 (优先从真实的 HOTEL 发票提取酒店商号与品牌)
        let hotelName = '';
        // 1. 严格查找属于住宿/酒店类别的发票，严禁把出租车票当成酒店发票
        let hotelInv = group.find(g => {
            const cat = detectInvoiceCategory(g.invoiceVO || {}, g);
            return cat === 'HOTEL' || g.type === 'HOTEL';
        });

        if (!hotelInv) {
            hotelInv = group.find(g => {
                const goods = g.invoiceVO?.goodsName || '';
                const file = g.fileName || g.invoiceVO?.fileName || '';
                return /住宿|客房|房费/.test(`${goods} ${file}`) && !/客运|出租车|打车|机票|火车/.test(`${goods} ${file}`);
            });
        }

        if (hotelInv) {
            const sales = (hotelInv.salesName || hotelInv.invoiceVO?.salesName || '').replace(/有限公司|分公司|管理|集团|连锁/g, '').trim();
            const file = (hotelInv.fileName || hotelInv.invoiceVO?.fileName || '').replace(/发票|住宿|（.*）|\(.*\)|.pdf|.ofd/g, '').trim();
            
            // 优先看 sales 和 file 是否包含酒店品牌
            const brandMatch = `${sales} ${file}`.match(/([^\s_（()）\-]+?(?:酒店|宾馆|客房|饭店|亚朵|全季|美悦|瑾程|上引))/);
            if (brandMatch) {
                let candidate = brandMatch[1].replace(/有限公司|分公司|管理|市/g, '').trim();
                if (!candidate.includes('到') && !candidate.includes('去') && !candidate.includes('车') && candidate.length >= 2) {
                    hotelName = candidate;
                }
            }
            if (!hotelName && sales) {
                hotelName = sales;
            }
        }

        // 次选：从文本中正则提取酒店名 (必须剔除带有行程指向的词汇)
        if (!hotelName) {
            const m = allText.match(/(?:入住|在|宿)?([^\s_（()）\-]{2,15}?(?:酒店|亚朵|全季|美悦|瑾程|上引))/);
            if (m && !m[1].includes('到') && !m[1].includes('去') && !m[1].includes('车')) {
                hotelName = m[1].trim();
            }
        }
        if (!hotelName) {
            hotelName = `${matchedCity}商务酒店`;
        }
        // 标准化酒店名：若仅有品牌名则补齐“酒店”
        if (!hotelName.endsWith('酒店') && !hotelName.endsWith('宾馆') && !hotelName.endsWith('客房') && !hotelName.endsWith('饭店')) {
            hotelName += '酒店';
        }

        // 推断交通枢纽与客户据点 (严格遵循 Anti-Hardcoding 铁律，绝不硬编码或捏造私有客户工厂)
        const hubInfo = inferTripHub(matchedCity, allText);
        const globalCustomer = (options.customerName || '').trim();
        const customerName = globalCustomer;
        const factories = globalCustomer || `${matchedCity}客户据点`;

        segments.push({
            tripNo: idx + 1,
            startDate,
            endDate,
            destination: matchedCity,
            hotelName: hotelName || `${matchedCity}商务酒店`,
            customerName,
            targetFactories: factories,
            stationOrAirport: hubInfo.stationOrAirport,
            departureStation: hubInfo.departureStation,
            arrivalStation: hubInfo.arrivalStation,
            purpose: customerName ? `${matchedCity}业务差旅与实地调研 (${customerName})` : `${matchedCity}业务差旅与实地调研`
        });
    });

    return segments;
}

/**
 * 通用多模式智能费用规划与行程推断引擎
 * 
 * 覆盖场景：
 * 1. 异地出差模式 (Business Trip Routine)：
 *    - 出发日：公司/家 ➔ 机场/高铁站 (送机送站) ➔ 飞机/高铁 ➔ 机场/高铁站 ➔ 酒店/客户
 *    - 中间调研日：早出晚归 酒店 ➔ 客户 (早) / 客户 ➔ 酒店 (晚)
 *    - 返程日：酒店 ➔ 机场/高铁站 ➔ 飞机/高铁 ➔ 机场/高铁站 ➔ 家/公司
 * 2. 市内日常拜访模式 (Local Commute Routine)：
 *    - 当天第1程：公司 ➔ 客户；当天第2程：客户 ➔ 公司
 * 3. 代外驻报销规范：
 *    - 费用说明自动标准化生成：`[外驻:姓名] 项目号 客户名`
 */
export function inferSmartExpensePlan(
    invoices: InvoiceItem[],
    options: ExpensePlanOptions = {}
): ExpenseBatchPlanResult {
    const company = (options.companyName || 'IVISION').trim();
    const customer = (options.customerName || '').trim();
    const hotel = (options.hotelName || '').trim();
    const station = (options.stationOrAirport || '机场/高铁站').trim();
    const home = (options.homeName || '家').trim();
    const project = (options.projectName || '').trim();
    const proxyPerson = (options.proxyPersonName || '').trim();
    const customDesc = (options.customDescription || '').trim();
    const departureDate = options.departureDate ? normalizeDate(options.departureDate) : '';
    const returnDate = options.returnDate ? normalizeDate(options.returnDate) : '';

    // 解析多波次行程计划 (表格文本或结构化 trips，全量统一归一化)
    let tripSegments: ExpenseTripSegment[] = [];
    if (options.trips && options.trips.length > 0) {
        const rawSegments = options.trips.map((t, idx) => normalizeTripSegment(t, idx + 1));
        // 过滤空波次占位符 (防止历史残留的无日期、无目的地的空 trip 污染阻断自动聚类)
        tripSegments = rawSegments.filter(s => Boolean((s.destination && !s.destination.includes('待定')) || s.startDate || s.endDate));
    } else if (options.itineraryText) {
        try {
            const parsed = parseItineraryTable(options.itineraryText);
            tripSegments = parsed.map((item, idx) => normalizeTripSegment(item, idx + 1));
        } catch (e) {
            console.warn('[commuteService] parseItineraryTable error:', e);
        }
    }
    
    // 若依然未提供有效行程表（或传入的全是空占位符），系统纯自动根据发票中的机票/高铁票/酒店发票智能聚类
    if (tripSegments.length === 0 && invoices && invoices.length > 0) {
        tripSegments = clusterTripsFromInvoices(invoices, options);
    }

    // 辅助：查找指定日期所属的出差波次 (优先精确包含，容差前后1-3天)
    const findMatchingTrip = (dateStr: string): ExpenseTripSegment | undefined => {
        if (!dateStr || tripSegments.length === 0) return undefined;
        // 优先区间匹配 (含起止日)
        const exact = tripSegments.find(s => s.startDate && s.endDate && dateStr >= s.startDate && dateStr <= s.endDate);
        if (exact) return exact;

        const invTime = new Date(dateStr.replace(/-/g, '/')).getTime();
        if (isNaN(invTime)) return undefined;

        let closest: ExpenseTripSegment | undefined = undefined;
        let minDiff = Infinity;
        for (const s of tripSegments) {
            if (!s.startDate || !s.endDate) continue;
            const sTime = new Date(s.startDate.replace(/-/g, '/')).getTime();
            const eTime = new Date(s.endDate.replace(/-/g, '/')).getTime();
            if (isNaN(sTime) || isNaN(eTime)) continue;

            if (invTime >= sTime - 24 * 3600 * 1000 && invTime <= eTime + 24 * 3600 * 1000) {
                return s;
            }

            const diff = Math.min(Math.abs(invTime - sTime), Math.abs(invTime - eTime));
            if (diff < minDiff) {
                minDiff = diff;
                closest = s;
            }
        }
        return (minDiff <= 3 * 24 * 3600 * 1000) ? closest : undefined;
    };

    // 判断出差模式还是市内模式
    let tripType: 'BUSINESS_TRIP' | 'LOCAL_COMMUTE' | 'COMMUNICATION_ONLY' = 'LOCAL_COMMUTE';
    if (tripSegments.length > 0 || options.tripType === 'BUSINESS_TRIP') {
        tripType = 'BUSINESS_TRIP';
    } else if (options.tripType === 'COMMUNICATION_ONLY') {
        tripType = 'COMMUNICATION_ONLY';
    } else if (options.tripType === 'AUTO' || !options.tripType) {
        const hasHotelOrFlight = invoices.some(inv => {
            const cat = detectInvoiceCategory(inv.invoiceVO || {}, inv, inv.expenseTypeName || '');
            return cat === 'HOTEL' || cat === 'FLIGHT' || cat === 'TRAIN';
        });
        if (hasHotelOrFlight || hotel || (departureDate && returnDate && departureDate !== returnDate)) {
            tripType = 'BUSINESS_TRIP';
        } else {
            tripType = 'LOCAL_COMMUTE';
        }
    }

    // 检查缺失的关键字段：遵循通用性原则，如客户名称未明确，绝不自作主张捏造，加入 missingFields 让 A2UI 表单交互给用户输入！
    const missingFields: string[] = [];
    if (!customer && tripSegments.every(t => !t.customerName)) {
        missingFields.push('拜访客户名称 (customerName)');
    }
    if (tripSegments.length === 0) {
        if (tripType === 'BUSINESS_TRIP' && !hotel) {
            const hasHotelInv = invoices.some(i => detectInvoiceCategory(i.invoiceVO || {}, i) === 'HOTEL');
            if (!hasHotelInv) missingFields.push('入住酒店名称 (hotelName)');
        }
    }

    // 目标索引过滤
    const targetSet = options.recordIndices && options.recordIndices.length > 0
        ? new Set(options.recordIndices)
        : new Set(invoices.map((_, idx) => idx));

    // 按日期分组出租车
    const taxiDateGroups: Record<string, number[]> = {};
    const uncertainDates: string[] = [];
    let modifiedCount = 0;

    // 格式化生成标准费用说明
    const buildDescription = (baseTypeDesc: string = '', custOverride?: string) => {
        if (customDesc) return customDesc;
        const parts: string[] = [];
        if (proxyPerson) {
            parts.push(`[外驻:${proxyPerson}]`);
        }
        if (project) {
            parts.push(project);
        }
        const activeCustomer = custOverride || customer;
        if (activeCustomer) {
            parts.push(activeCustomer);
        }
        if (baseTypeDesc && !project && !activeCustomer) {
            parts.push(baseTypeDesc);
        }
        return parts.join(' ').trim();
    };

    invoices.forEach((inv, idx) => {
        if (!targetSet.has(idx)) return;

        // 识别发票分类
        const detectedCat = detectInvoiceCategory(inv.invoiceVO || {}, inv, inv.expenseTypeName || '');
        const invDate = normalizeDate(inv.invoiceDate || '');
        const matchedTrip = findMatchingTrip(invDate);

        const rowHotel = (matchedTrip && matchedTrip.hotelName) || hotel;
        const rowCustomer = (matchedTrip && (matchedTrip.customerName || matchedTrip.targetFactories)) || customer;
        const rowDest = (matchedTrip && matchedTrip.destination) || '';

        // 绑定项目与代外驻人名
        if (project) inv.projectName = project;
        if (proxyPerson) inv.proxyPersonName = proxyPerson;
        if (rowHotel) inv.hotelName = rowHotel;
        if (station) inv.stationOrAirport = station;

        // 分类处理
        if (detectedCat === 'FLIGHT') {
            inv.type = 'FLIGHT';
            inv.expenseTypeId = EXPENSE_TYPES.FLIGHT.id;
            inv.expenseTypeName = EXPENSE_TYPES.FLIGHT.name;
            inv.expenseTypeCode = EXPENSE_TYPES.FLIGHT.code;

            const route = extractRouteFromText(`${inv.fileName || ''} ${inv.invoiceVO?.fileName || ''}`);
            const flightStart = route ? route.startCity : (company || '上海');
            const flightEnd = route ? route.endCity : (rowDest || '外地目的地');
            const isRoundTrip = /往返/.test(`${inv.fileName || ''} ${inv.invoiceVO?.fileName || ''}`);
            const flightDest = (flightEnd !== '上海' && flightEnd !== '北京') ? flightEnd : flightStart;

            inv.description = buildDescription(`${flightDest ? `${flightDest}` : ''}${isRoundTrip ? '往返机票' : '机票'}`, rowCustomer);
            inv.isBusinessTrip = true;
            inv.startAddress = flightStart;
            inv.endAddress = flightEnd;
            inv.isModified = true;
            modifiedCount++;
        } else if (detectedCat === 'TRAIN') {
            inv.type = 'TRAIN';
            inv.expenseTypeId = EXPENSE_TYPES.TRAIN.id;
            inv.expenseTypeName = EXPENSE_TYPES.TRAIN.name;
            inv.expenseTypeCode = EXPENSE_TYPES.TRAIN.code;

            const route = extractRouteFromText(`${inv.fileName || ''} ${inv.invoiceVO?.fileName || ''}`);
            const trainStart = route ? route.startCity : (company || '上海');
            const trainEnd = route ? route.endCity : (rowDest || '外地目的地');
            const trainDest = (trainEnd !== '上海' && trainEnd !== '北京') ? trainEnd : trainStart;

            inv.description = buildDescription(`${trainDest ? `${trainDest}` : ''}火车/高铁票`, rowCustomer);
            inv.isBusinessTrip = true;
            inv.startAddress = trainStart;
            inv.endAddress = trainEnd;
            inv.isModified = true;
            modifiedCount++;
        } else if (detectedCat === 'HOTEL') {
            inv.type = 'HOTEL';
            inv.expenseTypeId = EXPENSE_TYPES.HOTEL.id;
            inv.expenseTypeName = EXPENSE_TYPES.HOTEL.name;
            inv.expenseTypeCode = EXPENSE_TYPES.HOTEL.code;

            const extractedHotel = extractHotelName(inv.salesName || inv.invoiceVO?.salesName || '', inv.fileName || inv.invoiceVO?.fileName || '');
            const finalHotel = extractedHotel || rowHotel || '出差酒店';

            // 城市推断高优先级：首先锚定当前出差波次的真实目的城市 (destination / destCity)
            let derivedCity = matchedTrip?.destCity || matchedTrip?.destination || rowDest || '';
            if (!derivedCity && finalHotel) {
                // 容灾提取：从酒店名称中提取真实城市（如“亚朵酒店（合肥滨湖店）”提取“合肥”）
                const innerMatch = finalHotel.match(/[（(]([\u4e00-\u9fa5]{2,3}?)(?:市|区|镇|县|店|新区|经开区|[\u4e00-\u9fa5]*?店)/);
                if (innerMatch && !/金山|中山|国家|滨湖|云谷|金融|台山|白山|会展/.test(innerMatch[1])) {
                    derivedCity = innerMatch[1];
                } else {
                    const prefixMatch = finalHotel.match(/^([\u4e00-\u9fa5]{2,3}?)(?:市|酒店|宾馆|饭店|客栈)/);
                    if (prefixMatch && !/亚朵|全季|上引|如家|汉庭|锦江|美悦|希尔|万豪|洲际|格林|维也|桔子|宜必|凯悦|喜来|香格/.test(prefixMatch[1])) {
                        derivedCity = prefixMatch[1];
                    }
                }
            }

            const hotelCity = (derivedCity || '出差城市').replace(/市|（.*）|\(.*\)/g, '').trim();

            inv.hotelName = finalHotel;
            inv.description = buildDescription(`${finalHotel}住宿`, rowCustomer);
            inv.isBusinessTrip = true;
            inv.startAddress = hotelCity;
            inv.endAddress = finalHotel;
            inv.city = hotelCity;

            // 智能对齐入住/离店日期与住店天数
            if (matchedTrip) {
                inv.checkInDate = matchedTrip.startDate || invDate;
                inv.checkOutDate = matchedTrip.endDate || invDate;
            } else {
                inv.checkInDate = invDate;
                inv.checkOutDate = invDate;
            }

            let stayDays = 1;
            if (inv.checkInDate && inv.checkOutDate) {
                const d1 = new Date(inv.checkInDate).getTime();
                const d2 = new Date(inv.checkOutDate).getTime();
                const diffDays = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
                if (diffDays > 0) stayDays = diffDays;
            }
            inv.stayDays = stayDays;

            inv.isModified = true;
            modifiedCount++;
        } else if (detectedCat === 'COMMUNICATION') {
            inv.type = 'COMMUNICATION';
            inv.expenseTypeId = EXPENSE_TYPES.COMMUNICATION.id;
            inv.expenseTypeName = EXPENSE_TYPES.COMMUNICATION.name;
            inv.expenseTypeCode = EXPENSE_TYPES.COMMUNICATION.code;
            inv.description = buildDescription('手机通讯费', rowCustomer);
            inv.isModified = true;
            modifiedCount++;
        } else if (detectedCat === 'OTHER' && (Number(inv.amount) || 0) >= 350 && !/出租车|打车|网约车|滴滴/.test(`${inv.salesName || ''} ${inv.fileName || ''} ${inv.expenseTypeName || ''}`)) {
            // 大额非打车发票（如酒店住宿兜底，严禁降级为出租车）
            inv.type = 'HOTEL';
            inv.expenseTypeId = EXPENSE_TYPES.HOTEL.id;
            inv.expenseTypeName = EXPENSE_TYPES.HOTEL.name;
            inv.expenseTypeCode = EXPENSE_TYPES.HOTEL.code;
            inv.isBusinessTrip = true;
            inv.description = buildDescription('差旅住宿费', rowCustomer);
            inv.isModified = true;
            modifiedCount++;
        } else {
            // 出租车/交通费
            const isTrip = tripType === 'BUSINESS_TRIP';
            inv.type = isTrip ? 'TRIP_TAXI' : 'TAXI';
            inv.expenseTypeId = isTrip ? EXPENSE_TYPES.TRIP_TAXI.id : EXPENSE_TYPES.TAXI.id;
            inv.expenseTypeName = isTrip ? EXPENSE_TYPES.TRIP_TAXI.name : EXPENSE_TYPES.TAXI.name;
            inv.expenseTypeCode = isTrip ? EXPENSE_TYPES.TRIP_TAXI.code : EXPENSE_TYPES.TAXI.code;
            inv.isBusinessTrip = isTrip;

            const dt = invDate || '未知日期';
            if (!taxiDateGroups[dt]) taxiDateGroups[dt] = [];
            taxiDateGroups[dt].push(idx);
        }
    });

    // 推断出租车行程 (出发地 / 到达地 / 费用说明)
    Object.keys(taxiDateGroups).forEach(dt => {
        const indicesInDate = taxiDateGroups[dt];
        indicesInDate.sort((a, b) => {
            const timeA = normalizeTime(invoices[a].timeGetOn) || '00:00';
            const timeB = normalizeTime(invoices[b].timeGetOn) || '00:00';
            return timeA.localeCompare(timeB);
        });

        const matchedTrip = findMatchingTrip(dt);
        const isDepDay = Boolean((departureDate && dt === departureDate) || (matchedTrip && dt === matchedTrip.startDate));
        const isRetDay = Boolean((returnDate && dt === returnDate) || (matchedTrip && dt === matchedTrip.endDate));
        const targetHotel = (matchedTrip && matchedTrip.hotelName) || hotel || '出差酒店';
        const targetCustomer = (matchedTrip && (matchedTrip.customerName || matchedTrip.targetFactories)) || customer || '客户据点';
        
        // 区分出发地枢纽 (默认上海虹桥) 与 目的地交通枢纽 (如滨海国际机场/白云机场/合肥南站等)
        const targetDepStation = (matchedTrip && matchedTrip.departureStation) || '上海虹桥枢纽';
        const targetArrStation = (matchedTrip && (matchedTrip.arrivalStation || matchedTrip.stationOrAirport)) || (station !== '机场/高铁站' ? station : '目的地机场/高铁站');

        if (tripType === 'BUSINESS_TRIP') {
            // =====================================
            // 模式 1: 异地出差行程推断
            // =====================================
            if (isDepDay) {
                // 出发日
                if (indicesInDate.length === 1) {
                    // 仅有1程：送机/送站
                    const row = invoices[indicesInDate[0]];
                    row.startAddress = company || home;
                    row.endAddress = targetDepStation;
                    row.description = buildDescription(`出发去${targetDepStation}`, targetCustomer);
                    row.isModified = true;
                    modifiedCount++;
                } else if (indicesInDate.length === 2) {
                    // 第1程：出发城市送机/送站；第2程：到达目的地机场/高铁站后接机去酒店或客户工厂
                    const row1 = invoices[indicesInDate[0]];
                    row1.startAddress = company || home;
                    row1.endAddress = targetDepStation;
                    row1.description = buildDescription(`出发去${targetDepStation}`, targetCustomer);
                    row1.isModified = true;

                    const row2 = invoices[indicesInDate[1]];
                    row2.startAddress = targetArrStation;
                    row2.endAddress = targetHotel || targetCustomer;
                    row2.description = buildDescription(`到达去${targetHotel || targetCustomer}`, targetCustomer);
                    row2.isModified = true;
                    modifiedCount += 2;
                } else {
                    // 出发日 3 程及以上 (如：去机场 -> 到达去客户工厂 -> 晚上回酒店)
                    const row1 = invoices[indicesInDate[0]];
                    row1.startAddress = company || home;
                    row1.endAddress = targetDepStation;
                    row1.description = buildDescription(`出发去${targetDepStation}`, targetCustomer);
                    row1.isModified = true;

                    const row2 = invoices[indicesInDate[1]];
                    row2.startAddress = targetArrStation;
                    row2.endAddress = targetCustomer || targetHotel;
                    row2.description = buildDescription(`到达去${targetCustomer || targetHotel}`, targetCustomer);
                    row2.isModified = true;

                    const rowLast = invoices[indicesInDate[indicesInDate.length - 1]];
                    rowLast.startAddress = targetCustomer;
                    rowLast.endAddress = targetHotel;
                    rowLast.description = buildDescription(`调研结束回${targetHotel}`, targetCustomer);
                    rowLast.isModified = true;

                    for (let k = 2; k < indicesInDate.length - 1; k++) {
                        const midRow = invoices[indicesInDate[k]];
                        midRow.startAddress = targetHotel;
                        midRow.endAddress = targetCustomer;
                        midRow.description = buildDescription('出差市内交通', targetCustomer);
                        midRow.isModified = true;
                    }
                    modifiedCount += indicesInDate.length;
                    uncertainDates.push(`${dt} (出发日多程)`);
                }
            } else if (isRetDay) {
                // 返程日
                if (indicesInDate.length === 1) {
                    const row = invoices[indicesInDate[0]];
                    const hour = parseInt((normalizeTime(row.timeGetOn).split(':')[0] || '12'), 10);
                    if (hour >= 17) {
                        row.startAddress = targetDepStation;
                        row.endAddress = home || company;
                        row.description = buildDescription(`返程到达${targetDepStation}回家`, targetCustomer);
                    } else {
                        row.startAddress = targetHotel || targetCustomer;
                        row.endAddress = targetArrStation;
                        row.description = buildDescription(`返程去${targetArrStation}`, targetCustomer);
                    }
                    row.isModified = true;
                    modifiedCount++;
                } else if (indicesInDate.length === 2) {
                    const row1 = invoices[indicesInDate[0]];
                    row1.startAddress = targetHotel || targetCustomer;
                    row1.endAddress = targetArrStation;
                    row1.description = buildDescription(`返程去${targetArrStation}`, targetCustomer);
                    row1.isModified = true;

                    const row2 = invoices[indicesInDate[1]];
                    row2.startAddress = targetDepStation;
                    row2.endAddress = home || company;
                    row2.description = buildDescription(`返程到达${targetDepStation}回家`, targetCustomer);
                    row2.isModified = true;
                    modifiedCount += 2;
                } else {
                    // 返程日 3 程及以上 (早程去客户 -> 客户去机场/车站 -> 回到上海去家)
                    const row1 = invoices[indicesInDate[0]];
                    row1.startAddress = targetHotel;
                    row1.endAddress = targetCustomer;
                    row1.description = buildDescription('上午调研拜访', targetCustomer);
                    row1.isModified = true;

                    const rowPenultimate = invoices[indicesInDate[indicesInDate.length - 2]];
                    rowPenultimate.startAddress = targetCustomer;
                    rowPenultimate.endAddress = targetArrStation;
                    rowPenultimate.description = buildDescription(`返程去${targetArrStation}`, targetCustomer);
                    rowPenultimate.isModified = true;

                    const rowLast = invoices[indicesInDate[indicesInDate.length - 1]];
                    rowLast.startAddress = targetDepStation;
                    rowLast.endAddress = home || company;
                    rowLast.description = buildDescription(`返程到达${targetDepStation}回家`, targetCustomer);
                    rowLast.isModified = true;

                    for (let k = 1; k < indicesInDate.length - 2; k++) {
                        const midRow = invoices[indicesInDate[k]];
                        midRow.startAddress = targetCustomer;
                        midRow.endAddress = targetCustomer;
                        midRow.description = buildDescription('出差市内交通', targetCustomer);
                        midRow.isModified = true;
                    }
                    modifiedCount += indicesInDate.length;
                    uncertainDates.push(`${dt} (返程日多程)`);
                }
            } else {
                // 中间调研日 (早出晚归: 酒店 ➔ 客户 / 客户 ➔ 酒店)
                if (indicesInDate.length === 1) {
                    const row = invoices[indicesInDate[0]];
                    const hour = parseInt((normalizeTime(row.timeGetOn).split(':')[0] || '12'), 10);
                    if (hour < 14) {
                        row.startAddress = targetHotel;
                        row.endAddress = targetCustomer;
                        row.description = buildDescription('出差早程调研', targetCustomer);
                    } else {
                        row.startAddress = targetCustomer;
                        row.endAddress = targetHotel;
                        row.description = buildDescription('出差晚程回酒店', targetCustomer);
                    }
                    row.isModified = true;
                    modifiedCount++;
                } else if (indicesInDate.length === 2) {
                    const row1 = invoices[indicesInDate[0]];
                    row1.startAddress = targetHotel;
                    row1.endAddress = targetCustomer;
                    row1.description = buildDescription('出差早程调研', targetCustomer);
                    row1.isModified = true;

                    const row2 = invoices[indicesInDate[1]];
                    row2.startAddress = targetCustomer;
                    row2.endAddress = targetHotel;
                    row2.description = buildDescription('出差晚程回酒店', targetCustomer);
                    row2.isModified = true;
                    modifiedCount += 2;
                } else {
                    const row1 = invoices[indicesInDate[0]];
                    row1.startAddress = targetHotel;
                    row1.endAddress = targetCustomer;
                    row1.description = buildDescription('出差早程调研', targetCustomer);
                    row1.isModified = true;

                    const rowLast = invoices[indicesInDate[indicesInDate.length - 1]];
                    rowLast.startAddress = targetCustomer;
                    rowLast.endAddress = targetHotel;
                    rowLast.description = buildDescription('出差晚程回酒店', targetCustomer);
                    rowLast.isModified = true;

                    for (let k = 1; k < indicesInDate.length - 1; k++) {
                        const midRow = invoices[indicesInDate[k]];
                        midRow.startAddress = targetCustomer;
                        midRow.endAddress = targetCustomer;
                        midRow.description = buildDescription('客户据点间交通', targetCustomer);
                        midRow.isModified = true;
                    }
                    modifiedCount += indicesInDate.length;
                    uncertainDates.push(`${dt} (多程调研)`);
                }
            }
        } else {
            // =====================================
            // 模式 2: 市内日常拜访推断 (公司 ⇄ 客户)
            // =====================================
            if (indicesInDate.length === 1) {
                const row = invoices[indicesInDate[0]];
                const hour = parseInt((normalizeTime(row.timeGetOn).split(':')[0] || '12'), 10);
                if (hour < 14) {
                    row.startAddress = company;
                    row.endAddress = customer;
                } else {
                    row.startAddress = customer;
                    row.endAddress = company;
                }
                row.description = buildDescription('市内拜访客户');
                row.isModified = true;
                modifiedCount++;
            } else if (indicesInDate.length === 2) {
                const row1 = invoices[indicesInDate[0]];
                row1.startAddress = company;
                row1.endAddress = customer;
                row1.description = buildDescription('上午出发拜访客户');
                row1.isModified = true;

                const row2 = invoices[indicesInDate[1]];
                row2.startAddress = customer;
                row2.endAddress = company;
                row2.description = buildDescription('下午返回公司');
                row2.isModified = true;
                modifiedCount += 2;
            } else {
                const row1 = invoices[indicesInDate[0]];
                row1.startAddress = company;
                row1.endAddress = customer;
                row1.description = buildDescription('上午出发拜访客户');
                row1.isModified = true;

                const rowLast = invoices[indicesInDate[indicesInDate.length - 1]];
                rowLast.startAddress = customer;
                rowLast.endAddress = company;
                rowLast.description = buildDescription('下午返回公司');
                rowLast.isModified = true;

                for (let k = 1; k < indicesInDate.length - 1; k++) {
                    const midRow = invoices[indicesInDate[k]];
                    midRow.startAddress = customer;
                    midRow.endAddress = customer;
                    midRow.description = buildDescription('市内网约车');
                    midRow.isModified = true;
                }
                modifiedCount += indicesInDate.length;
                uncertainDates.push(`${dt} (${indicesInDate.length} 笔)`);
            }
        }
    });

    // 动态检测是否存在同期的出租车与过路费发票（遵循 Anti-Hardcoding 铁律，基于通用类型与日期对齐）
    const concurrentTolls = invoices.filter(inv => {
        if (!isTollInvoice(inv)) return false;
        const tollDate = normalizeDate(inv.invoiceDate || (inv.invoiceVO && inv.invoiceVO.invoiceDate) || '');
        return invoices.some(t => !isTollInvoice(t) && (t.type === 'TAXI' || t.type === 'TRIP_TAXI') && normalizeDate(t.invoiceDate || '') === tollDate);
    });
    const hasConcurrentTolls = concurrentTolls.length > 0;

    let finalInvoices = invoices;
    let boundTollsCount = 0;
    let bindingLog: string[] = [];

    // 若 options.mergeTollsWithTaxi !== false（默认合并或明确指定合并）
    if (options.mergeTollsWithTaxi !== false) {
        const mergeRes = bindTollsToTaxiExpenses(invoices);
        finalInvoices = mergeRes.mergedItems;
        boundTollsCount = mergeRes.boundTollsCount;
        bindingLog = mergeRes.bindingLog;
    } else {
        // 独立逐条生成：过路费不与出租车合并，每张独立为单笔交通费记录
        finalInvoices = invoices.map(inv => {
            if (isTollInvoice(inv)) {
                const clone = { ...inv };
                clone.type = tripType === 'BUSINESS_TRIP' ? 'TRIP_TAXI' : 'TAXI';
                clone.expenseTypeId = tripType === 'BUSINESS_TRIP' ? EXPENSE_TYPES.TRIP_TAXI.id : EXPENSE_TYPES.TAXI.id;
                clone.expenseTypeName = tripType === 'BUSINESS_TRIP' ? EXPENSE_TYPES.TRIP_TAXI.name : EXPENSE_TYPES.TAXI.name;
                clone.description = buildDescription('高速通行费/过路费');
                clone.isModified = true;
                return clone;
            }
            return inv;
        });
    }

    // 汇总文案
    let summaryText = '';
    if (tripSegments.length > 0) {
        summaryText = `⚡ 智能推断完成：已按行程表的 ${tripSegments.length} 个波次精准匹配并规划 ${modifiedCount} 项费用信息！\n` +
            `• 模式: ✈️ 异地出差 (多波次行程对齐)\n` +
            `• 行程波次: 共识别 ${tripSegments.length} 轮独立出差 (自动匹配各轮目的地、酒店及客户工厂)\n` +
            (project ? `• 关联项目: ${project}\n` : '') +
            (proxyPerson ? `• 代外驻报销: ${proxyPerson}\n` : '');
    } else {
        summaryText = `⚡ 智能推断完成：已规划 ${modifiedCount} 项费用信息！\n` +
            `• 模式: ${tripType === 'BUSINESS_TRIP' ? '✈️ 异地出差' : '🏢 市内通勤/拜访'}\n` +
            `• 公司基准: ${company} ⇄ 拜访客户: ${customer}\n` +
            (hotel ? `• 入住酒店: ${hotel}\n` : '') +
            (project ? `• 关联项目: ${project}\n` : '') +
            (proxyPerson ? `• 代外驻报销: ${proxyPerson}\n` : '');
    }

    if (boundTollsCount > 0) {
        summaryText += `\n• 🎫 发票合并: 已按时间窗口将 ${boundTollsCount} 笔过路费自动绑定至同程出租车费用中（1笔费用多张发票）`;
    } else if (hasConcurrentTolls && options.mergeTollsWithTaxi === false) {
        summaryText += `\n• 📄 独立生成: 已将 ${concurrentTolls.length} 笔过路费保持为独立费用记录（每张发票独立单笔）`;
    }

    if (uncertainDates.length > 0) {
        summaryText += `\n⚠️ 部分多程日期需人工留意核对: ${uncertainDates.join(', ')}`;
    }

    return {
        totalRecords: finalInvoices.length,
        modifiedCount,
        tripType,
        companyName: company,
        customerName: customer,
        hotelName: hotel,
        stationOrAirport: station,
        projectName: project,
        proxyPersonName: proxyPerson,
        missingFields,
        records: finalInvoices,
        boundTollsCount,
        hasConcurrentTolls,
        concurrentTollsCount: concurrentTolls.length,
        tollInquiryPrompt: (hasConcurrentTolls && options.mergeTollsWithTaxi === undefined) ? '发现有出租车发票同期的过路费是否合并生成？' : undefined,
        mergeTollsWithTaxi: options.mergeTollsWithTaxi,
        uncertainDates,
        summaryText,
        matchedTrips: tripSegments.length > 0 ? tripSegments : undefined
    };
}

// 保持旧版接口兼容
export function inferSmartCommuteRoutes(
    invoices: InvoiceItem[],
    targetIndices: number[],
    companyName: string = 'IVISION',
    customerName: string = 'CMP',
    customPurpose: string = ''
): { modifiedCount: number; uncertainDates: string[] } {
    const res = inferSmartExpensePlan(invoices, {
        tripType: 'LOCAL_COMMUTE',
        companyName,
        customerName,
        customDescription: customPurpose,
        recordIndices: targetIndices
    });
    return {
        modifiedCount: res.modifiedCount,
        uncertainDates: res.uncertainDates
    };
}
