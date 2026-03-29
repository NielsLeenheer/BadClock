import './digital.css';

// 7-segment polygon points (viewBox 0 0 57 100)
const SEG_PTS = {
    a: '13,4  17,0  40,0  44,4  40,8  17,8',
    b: '46,6  51,11 51,43 46,48 41,43 41,11',
    c: '46,52 51,57 51,89 46,94 41,89 41,57',
    d: '13,96 17,92 40,92 44,96 40,100 17,100',
    e: '11,52 16,57 16,89 11,94  6,89  6,57',
    f: '11,6  16,11 16,43 11,48  6,43  6,11',
    g: '13,50 17,46 40,46 44,50 40,54 17,54',
};

// Which segments are on for each digit 0-9
const DIGIT_MAP = {
    0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg',
    4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc',
    8: 'abcdefg', 9: 'abcdfg',
};

// Segment center points and whether horizontal (for hit detection)
const SEG_CENTERS = {
    a: { x: 28.5, y: 4,  hz: true },
    b: { x: 46,   y: 27, hz: false },
    c: { x: 46,   y: 73, hz: false },
    d: { x: 28.5, y: 96, hz: true },
    e: { x: 11,   y: 73, hz: false },
    f: { x: 11,   y: 27, hz: false },
    g: { x: 28.5, y: 50, hz: true },
};

// Reverse lookup: segment-pattern → digit value
const PATTERN_TO_DIGIT = {};
for (const [digit, segs] of Object.entries(DIGIT_MAP)) {
    const key = 'abcdefg'.split('').map(s => segs.includes(s) ? '1' : '0').join('');
    PATTERN_TO_DIGIT[key] = parseInt(digit);
}

export class DigitalClock {
    /**
     * @param {HTMLElement} container
     * @param {{ value: number }} time - shared time offset ref
     */
    constructor(container, time) {
        this.container = container;
        this.time = time;
        this.digits = [];

        this.buildDisplay();
    }

    /* ---- DOM construction ---- */

    buildDisplay() {
        const row = document.createElement('div');
        row.className = 'digital-digits';

        for (let i = 0; i < 4; i++) {
            if (i === 2) {
                const colon = document.createElement('div');
                colon.className = 'digital-colon';
                colon.innerHTML = '<div class="colon-dot"></div><div class="colon-dot"></div>';
                row.appendChild(colon);
            }
            row.appendChild(this.buildDigit(i));
        }

        this.container.appendChild(row);
    }

    buildDigit(index) {
        const wrap = document.createElement('div');
        wrap.className = 'digital-digit';
        wrap.dataset.index = index;

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 57 100');
        svg.classList.add('digit-svg');

        const segments = {};
        for (const [name, pts] of Object.entries(SEG_PTS)) {
            const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            poly.setAttribute('points', pts);
            poly.classList.add('segment', 'off');
            poly.dataset.seg = name;
            poly.dataset.digit = index;
            poly.style.pointerEvents = 'none';

            svg.appendChild(poly);
            segments[name] = poly;
        }

        // Single click handler on the SVG - find nearest segment
        svg.addEventListener('click', (e) => {
            const pt = svg.createSVGPoint();
            pt.x = e.clientX;
            pt.y = e.clientY;
            const svgPt = pt.matrixTransform(svg.getScreenCTM().inverse());

            let bestSeg = null;
            let bestDist = Infinity;

            for (const [name, center] of Object.entries(SEG_CENTERS)) {
                const dx = svgPt.x - center.x;
                const dy = svgPt.y - center.y;
                const scale = center.hz ? 0.6 : 1.0;
                const dist = Math.sqrt(dx * dx + dy * dy) * scale;
                if (dist < bestDist) {
                    bestDist = dist;
                    bestSeg = name;
                }
            }

            if (bestSeg) {
                this.onSegmentTap(index, bestSeg);
            }
        });

        const digitState = {
            el: wrap,
            svg,
            segments,
            state: 'normal',
            segOn: { a: false, b: false, c: false, d: false, e: false, f: false, g: false },
            editTimeout: null,
        };
        this.digits.push(digitState);

        wrap.appendChild(svg);
        return wrap;
    }

    /* ---- Segment interaction ---- */

    onSegmentTap(di, segName) {
        const d = this.digits[di];

        if (d.state === 'error') {
            d.el.classList.remove('error');
            for (const s of 'abcdefg') d.segOn[s] = false;
        }

        d.state = 'editing';
        d.el.classList.add('editing');

        d.segOn[segName] = !d.segOn[segName];
        this.renderDigit(di);

        if (d.editTimeout) clearTimeout(d.editTimeout);
        d.editTimeout = setTimeout(() => this.finalizeEdit(di), 2000);
    }

    finalizeEdit(di) {
        const d = this.digits[di];
        d.editTimeout = null;
        d.el.classList.remove('editing');

        const key = 'abcdefg'.split('').map(s => d.segOn[s] ? '1' : '0').join('');
        const value = PATTERN_TO_DIGIT[key];
        const allOff = key === '0000000';

        if (value !== undefined && this.isValidInContext(di, value)) {
            d.state = 'normal';
            this.applyDigitValue(di, value);
        } else if (allOff) {
            d.state = 'normal';
        } else {
            this.enterErrorMode(di);
        }
    }

    isValidInContext(di, value) {
        const now = new Date(Date.now() + this.time.value);
        let h = now.getHours(), m = now.getMinutes();

        switch (di) {
            case 0: h = value * 10 + (h % 10); break;
            case 1: h = Math.floor(h / 10) * 10 + value; break;
            case 2: m = value * 10 + (m % 10); break;
            case 3: m = Math.floor(m / 10) * 10 + value; break;
        }

        return h <= 23 && m <= 59;
    }

    enterErrorMode(di) {
        const d = this.digits[di];
        let tick = 0;

        const iv = setInterval(() => {
            if (tick >= 6) {
                clearInterval(iv);
                for (const s of 'abcdefg') d.segOn[s] = false;
                d.state = 'error';
                d.el.classList.add('error');
                this.renderDigit(di);
                return;
            }

            const show = tick % 2 === 0;
            for (const [s, poly] of Object.entries(d.segments)) {
                if (d.segOn[s]) {
                    poly.classList.toggle('on', show);
                    poly.classList.toggle('off', !show);
                }
            }
            tick++;
        }, 130);
    }

    applyDigitValue(di, value) {
        const now = new Date(Date.now() + this.time.value);
        let h = now.getHours(), m = now.getMinutes();

        switch (di) {
            case 0: h = value * 10 + (h % 10); break;
            case 1: h = Math.floor(h / 10) * 10 + value; break;
            case 2: m = value * 10 + (m % 10); break;
            case 3: m = Math.floor(m / 10) * 10 + value; break;
        }

        const target = new Date(now);
        target.setHours(h, m, now.getSeconds(), now.getMilliseconds());
        this.time.value = target.getTime() - Date.now();
    }

    /* ---- Rendering ---- */

    renderDigit(di) {
        const d = this.digits[di];
        for (const [name, poly] of Object.entries(d.segments)) {
            const on = d.segOn[name];
            poly.classList.toggle('on', on);
            poly.classList.toggle('off', !on);
        }
    }

    setDigitValue(di, value) {
        const d = this.digits[di];
        if (d.state !== 'normal') return;

        const pattern = DIGIT_MAP[value] || '';
        for (const s of 'abcdefg') {
            d.segOn[s] = pattern.includes(s);
        }
        this.renderDigit(di);
    }

    /* ---- Called every frame ---- */

    update() {
        const now = new Date(Date.now() + this.time.value);
        const h = now.getHours(), m = now.getMinutes();

        const vals = [
            Math.floor(h / 10), h % 10,
            Math.floor(m / 10), m % 10,
        ];

        for (let i = 0; i < 4; i++) {
            this.setDigitValue(i, vals[i]);
        }
    }
}
