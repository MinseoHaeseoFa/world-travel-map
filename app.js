/**
 * 세계 여행 지도 (World Travel Map) v1.0
 * 전 세계 195개국 인터랙티브 방문 기록 & 랜드마크 아카이브
 */

// 로컬 스토리지 키
const STORAGE_KEY = 'world_travel_records_v1';

// 상태 관리
let travelRecords = {};
let selectedCountryId = null;
let showLabels = true;
let currentFilter = 'all';

// DOM 요소
const svg = d3.select('#world-map-svg');
const tooltip = document.getElementById('hover-tooltip');
const drawer = document.getElementById('detail-drawer');

// SVG 크기 및 프로젝션 설정
const width = 1200;
const height = 650;

svg.attr('viewBox', `0 0 ${width} ${height}`);

const projection = d3.geoNaturalEarth1()
  .scale(210)
  .translate([width / 2, height / 2 + 20]);

const path = d3.geoPath().projection(projection);

// 메인 g 컨테이너 (줌/팬 적용 대상)
const g = svg.append('g').attr('id', 'map-root');
const gCountries = g.append('g').attr('class', 'countries-layer');
const gLabels = g.append('g').attr('class', 'labels-layer');

// 줌 동작 정의
const zoom = d3.zoom()
  .scaleExtent([1, 15])
  .on('zoom', (event) => {
    g.attr('transform', event.transform);
  });

svg.call(zoom);

// 지리 데이터 변환
let countriesFeatures = [];
if (typeof WORLD_TOPO_DATA !== 'undefined' && typeof topojson !== 'undefined') {
  countriesFeatures = topojson.feature(WORLD_TOPO_DATA, WORLD_TOPO_DATA.objects.countries).features;
}

// 초기화 실행
document.addEventListener('DOMContentLoaded', () => {
  loadRecords();
  initMap();
  initUI();
  updateStats();
});

/**
 * 로컬 스토리지 데이터 로드
 */
function loadRecords() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      travelRecords = JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to load records from storage', e);
    travelRecords = {};
  }
}

/**
 * 로컬 스토리지에 데이터 저장
 */
function saveRecords() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(travelRecords));
    updateStats();
    updateMapColors();
  } catch (e) {
    console.error('Failed to save records to storage', e);
  }
}

/**
 * 색상 결정 헬퍼 함수
 */
function getCountryColor(countryId) {
  const rec = travelRecords[countryId];
  if (!rec || !rec.status) return 'var(--c-unvisited)';

  switch (rec.status) {
    case 'visited': return 'var(--c-visited)';
    case 'living': return 'var(--c-living)';
    case 'bucket': return 'var(--c-bucket)';
    default: return 'var(--c-unvisited)';
  }
}

/**
 * D3 세계 지도 렌더링
 */
function initMap() {
  if (!countriesFeatures.length) return;

  // 1. 국가 패스 렌더링
  gCountries.selectAll('path')
    .data(countriesFeatures)
    .enter()
    .append('path')
    .attr('class', 'country-path')
    .attr('d', path)
    .attr('id', d => `country-${d.id}`)
    .attr('fill', d => getCountryColor(d.id))
    .on('mouseenter', (event, d) => handleMouseEnter(event, d))
    .on('mousemove', (event) => handleMouseMove(event))
    .on('mouseleave', () => handleMouseLeave())
    .on('click', (event, d) => {
      event.stopPropagation();
      openCountryDrawer(d.id);
    });

  // 2. 국가 라벨 렌더링
  gLabels.selectAll('text')
    .data(countriesFeatures)
    .enter()
    .append('text')
    .attr('class', 'country-label')
    .attr('transform', d => {
      const centroid = path.centroid(d);
      if (isNaN(centroid[0]) || isNaN(centroid[1])) return 'translate(-999,-999)';
      return `translate(${centroid[0]}, ${centroid[1]})`;
    })
    .text(d => {
      const info = COUNTRIES_DATA[d.id];
      return info ? info.name : (d.properties && d.properties.name ? d.properties.name : '');
    })
    .style('display', showLabels ? 'block' : 'none');

  // 배경 클릭 시 서랍 닫기
  svg.on('click', () => {
    closeDrawer();
  });
}

/**
 * 지도 색상 일괄 갱신
 */
function updateMapColors() {
  gCountries.selectAll('.country-path')
    .transition()
    .duration(250)
    .attr('fill', d => getCountryColor(d.id));
}

/**
 * 마우스 호버 처리
 */
function handleMouseEnter(event, d) {
  const info = COUNTRIES_DATA[d.id] || {
    name: (d.properties && d.properties.name) || '알 수 없는 지역',
    nameEn: '',
    flag: '🌐',
    continent: '기타',
    capital: '-',
    landmarks: []
  };

  const rec = travelRecords[d.id];
  let statusText = '⬜ 미방문';
  if (rec && rec.status) {
    if (rec.status === 'visited') statusText = '🟢 방문 완료';
    else if (rec.status === 'living') statusText = '✈️ 체류·거주';
    else if (rec.status === 'bucket') statusText = '🌟 버킷리스트';
  }

  document.getElementById('tt-flag').textContent = info.flag || '🌐';
  document.getElementById('tt-name').textContent = info.name;
  document.getElementById('tt-en').textContent = info.nameEn || '';
  document.getElementById('tt-status').textContent = statusText;
  document.getElementById('tt-info').textContent = `수도: ${info.capital || '-'} · ${info.continent || '-'}`;

  const landmarksUl = document.getElementById('tt-landmarks-list');
  landmarksUl.innerHTML = '';
  const topSpots = (info.landmarks || []).slice(0, 3);
  topSpots.forEach(spot => {
    const li = document.createElement('li');
    li.textContent = `• ${spot}`;
    landmarksUl.appendChild(li);
  });

  tooltip.classList.remove('hidden');
}

function handleMouseMove(event) {
  const viewport = document.getElementById('map-viewport').getBoundingClientRect();
  const x = event.clientX - viewport.left + 15;
  const y = event.clientY - viewport.top + 15;

  // 경계 벗어남 방지
  const maxW = viewport.width - 260;
  const maxH = viewport.height - 200;

  tooltip.style.left = `${Math.min(x, maxW)}px`;
  tooltip.style.top = `${Math.min(y, maxH)}px`;
}

function handleMouseLeave() {
  tooltip.classList.add('hidden');
}

/**
 * 상세 서랍 열기
 */
function openCountryDrawer(countryId) {
  const info = COUNTRIES_DATA[countryId];
  if (!info) return;

  selectedCountryId = countryId;

  // 이전 선택 강조 해제 및 신규 강조
  gCountries.selectAll('.country-path').classed('active-selected', false);
  d3.select(`#country-${countryId}`).classed('active-selected', true);

  // 정보 채우기
  document.getElementById('drawer-flag').textContent = info.flag || '🌐';
  document.getElementById('drawer-continent').textContent = info.continent || '기타';
  document.getElementById('drawer-name').textContent = info.name;
  document.getElementById('drawer-en-name').textContent = info.nameEn || '';
  document.getElementById('drawer-capital').textContent = info.capital || '-';
  document.getElementById('drawer-currency').textContent = info.currency || '-';

  const rec = travelRecords[countryId] || { status: null, spots: [], customSpots: [], date: '', memo: '' };

  // 상태 태그 및 버튼 활성화
  updateDrawerStatusUI(rec.status);

  // 랜드마크 체크리스트 렌더링
  renderLandmarksList(info, rec);

  // 날짜 & 메모
  document.getElementById('visit-date-input').value = rec.date || '';
  document.getElementById('travel-memo').value = rec.memo || '';

  drawer.classList.remove('hidden');

  // 해당 국가로 부드럽게 줌인
  zoomToCountry(countryId);
}

/**
 * 서랍 닫기
 */
function closeDrawer() {
  drawer.classList.add('hidden');
  selectedCountryId = null;
  gCountries.selectAll('.country-path').classed('active-selected', false);
}

/**
 * 특정 국가로 지도 부드럽게 줌인
 */
function zoomToCountry(countryId) {
  const feature = countriesFeatures.find(f => f.id === countryId);
  if (!feature) return;

  const bounds = path.bounds(feature);
  const dx = bounds[1][0] - bounds[0][0];
  const dy = bounds[1][1] - bounds[0][1];
  const x = (bounds[0][0] + bounds[1][0]) / 2;
  const y = (bounds[0][1] + bounds[1][1]) / 2;

  const scale = Math.max(1.5, Math.min(8, 0.75 / Math.max(dx / width, dy / height)));
  const translate = [width / 2 - scale * x - 100, height / 2 - scale * y];

  svg.transition()
    .duration(750)
    .call(zoom.transform, d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale));
}

/**
 * 서랍 내 방문 상태 UI 갱신
 */
function updateDrawerStatusUI(status) {
  const tag = document.getElementById('current-status-tag');
  const buttons = document.querySelectorAll('.status-btn');

  buttons.forEach(b => b.classList.remove('active'));

  if (!status) {
    tag.className = 'status-tag status-none';
    tag.textContent = '⬜ 미방문';
    return;
  }

  const activeBtn = document.querySelector(`.status-btn[data-status="${status}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  tag.className = `status-tag status-${status}`;
  if (status === 'visited') tag.textContent = '🟢 방문 완료';
  else if (status === 'living') tag.textContent = '✈️ 체류·거주';
  else if (status === 'bucket') tag.textContent = '🌟 버킷리스트';
}

/**
 * 랜드마크 체크리스트 렌더링
 */
function renderLandmarksList(info, rec) {
  const container = document.getElementById('landmarks-list');
  container.innerHTML = '';

  const defaultSpots = info.landmarks || [];
  const customSpots = rec.customSpots || [];
  const allSpots = [...defaultSpots, ...customSpots];
  const checkedSpots = new Set(rec.spots || []);

  allSpots.forEach(spotName => {
    const item = document.createElement('div');
    const isChecked = checkedSpots.has(spotName);
    item.className = `spot-item ${isChecked ? 'checked' : ''}`;

    const left = document.createElement('div');
    left.className = 'spot-left';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = isChecked;

    const span = document.createElement('span');
    span.textContent = spotName;

    left.appendChild(checkbox);
    left.appendChild(span);

    // 구글 지도 검색 링크
    const mapLink = document.createElement('a');
    mapLink.className = 'spot-map-link';
    mapLink.href = `https://www.google.com/maps/search/${encodeURIComponent(info.name + ' ' + spotName)}`;
    mapLink.target = '_blank';
    mapLink.rel = 'noopener';
    mapLink.textContent = '🗺️ 지도';
    mapLink.title = '구글 지도에서 위치 확인';
    mapLink.onclick = (e) => e.stopPropagation();

    item.appendChild(left);
    item.appendChild(mapLink);

    // 항목 클릭 시 토글
    item.addEventListener('click', () => {
      checkbox.checked = !checkbox.checked;
      toggleSpot(spotName, checkbox.checked);
    });

    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSpot(spotName, checkbox.checked);
    });

    container.appendChild(item);
  });

  updateSpotsCounter(checkedSpots.size, allSpots.length);
}

/**
 * 랜드마크 체크 상태 토글
 */
function toggleSpot(spotName, isChecked) {
  if (!selectedCountryId) return;

  if (!travelRecords[selectedCountryId]) {
    travelRecords[selectedCountryId] = { status: 'visited', spots: [], customSpots: [], date: '', memo: '' };
    updateDrawerStatusUI('visited');
  }

  const rec = travelRecords[selectedCountryId];
  if (!rec.spots) rec.spots = [];

  if (isChecked) {
    if (!rec.spots.includes(spotName)) rec.spots.push(spotName);
    // 명소 체크 시 자동으로 방문 완료로 지정 (미방문 상태였다면)
    if (!rec.status) {
      rec.status = 'visited';
      updateDrawerStatusUI('visited');
    }
  } else {
    rec.spots = rec.spots.filter(s => s !== spotName);
  }

  saveRecords();
  const info = COUNTRIES_DATA[selectedCountryId];
  renderLandmarksList(info, rec);
}

function updateSpotsCounter(checked, total) {
  document.getElementById('spots-counter').textContent = `(${checked}/${total} 완료)`;
}

/**
 * 종합 통계 갱신
 */
function updateStats() {
  const allIds = Object.keys(COUNTRIES_DATA).filter(id => id !== 'KOS' && id !== 'SOL' && id !== 'CYN');
  const total = 195; // 공식 UN 기준 195개국

  let visitedCount = 0;
  let livingCount = 0;
  let bucketCount = 0;
  let totalLandmarks = 0;

  Object.values(travelRecords).forEach(rec => {
    if (rec.status === 'visited') visitedCount++;
    else if (rec.status === 'living') livingCount++;
    else if (rec.status === 'bucket') bucketCount++;

    if (rec.spots && rec.spots.length) {
      totalLandmarks += rec.spots.length;
    }
  });

  const totalVisited = visitedCount + livingCount;
  const percent = ((totalVisited / total) * 100).toFixed(1);

  document.getElementById('visited-count').textContent = totalVisited;
  document.getElementById('total-count').textContent = total;
  document.getElementById('visit-percent').textContent = `${percent}%`;
  document.getElementById('stat-progress-bar').style.width = `${Math.min(100, percent)}%`;

  document.getElementById('lvl-visited').textContent = visitedCount;
  document.getElementById('lvl-living').textContent = livingCount;
  document.getElementById('lvl-bucket').textContent = bucketCount;
  document.getElementById('landmarks-count').textContent = totalLandmarks;
}

/**
 * UI 이벤트 핸들러 바인딩
 */
function initUI() {
  // 1. 서랍 닫기 버튼
  document.getElementById('drawer-close').addEventListener('click', closeDrawer);

  // 2. 방문 등급 버튼 클릭
  document.querySelectorAll('.status-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!selectedCountryId) return;
      const status = btn.getAttribute('data-status');

      if (!travelRecords[selectedCountryId]) {
        travelRecords[selectedCountryId] = { status: null, spots: [], customSpots: [], date: '', memo: '' };
      }

      travelRecords[selectedCountryId].status = status;
      updateDrawerStatusUI(status);
      saveRecords();
    });
  });

  // 3. 방문 취소 버튼
  document.getElementById('btn-clear-status').addEventListener('click', () => {
    if (!selectedCountryId) return;
    if (travelRecords[selectedCountryId]) {
      travelRecords[selectedCountryId].status = null;
      updateDrawerStatusUI(null);
      saveRecords();
    }
  });

  // 4. 명소 모두 선택 / 모두 해제
  document.getElementById('btn-select-all-spots').addEventListener('click', () => {
    if (!selectedCountryId) return;
    const info = COUNTRIES_DATA[selectedCountryId];
    if (!info) return;

    if (!travelRecords[selectedCountryId]) {
      travelRecords[selectedCountryId] = { status: 'visited', spots: [], customSpots: [], date: '', memo: '' };
      updateDrawerStatusUI('visited');
    }

    const allSpots = [...(info.landmarks || []), ...(travelRecords[selectedCountryId].customSpots || [])];
    travelRecords[selectedCountryId].spots = [...allSpots];
    if (!travelRecords[selectedCountryId].status) {
      travelRecords[selectedCountryId].status = 'visited';
      updateDrawerStatusUI('visited');
    }
    saveRecords();
    renderLandmarksList(info, travelRecords[selectedCountryId]);
  });

  document.getElementById('btn-deselect-all-spots').addEventListener('click', () => {
    if (!selectedCountryId || !travelRecords[selectedCountryId]) return;
    travelRecords[selectedCountryId].spots = [];
    saveRecords();
    const info = COUNTRIES_DATA[selectedCountryId];
    renderLandmarksList(info, travelRecords[selectedCountryId]);
  });

  // 5. 나만의 명소 추가
  document.getElementById('btn-add-custom-spot').addEventListener('click', addCustomSpot);
  document.getElementById('custom-spot-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addCustomSpot();
  });

  function addCustomSpot() {
    if (!selectedCountryId) return;
    const input = document.getElementById('custom-spot-input');
    const val = input.value.trim();
    if (!val) return;

    if (!travelRecords[selectedCountryId]) {
      travelRecords[selectedCountryId] = { status: 'visited', spots: [], customSpots: [], date: '', memo: '' };
    }
    const rec = travelRecords[selectedCountryId];
    if (!rec.customSpots) rec.customSpots = [];
    if (!rec.customSpots.includes(val)) {
      rec.customSpots.push(val);
      if (!rec.spots) rec.spots = [];
      rec.spots.push(val); // 자동 체크
      saveRecords();
      renderLandmarksList(COUNTRIES_DATA[selectedCountryId], rec);
      input.value = '';
    }
  }

  // 6. 방문 일자 & 메모 자동 저장
  document.getElementById('visit-date-input').addEventListener('input', (e) => {
    if (!selectedCountryId) return;
    if (!travelRecords[selectedCountryId]) {
      travelRecords[selectedCountryId] = { status: 'visited', spots: [], customSpots: [], date: '', memo: '' };
    }
    travelRecords[selectedCountryId].date = e.target.value;
    saveRecords();
  });

  document.getElementById('travel-memo').addEventListener('input', (e) => {
    if (!selectedCountryId) return;
    if (!travelRecords[selectedCountryId]) {
      travelRecords[selectedCountryId] = { status: 'visited', spots: [], customSpots: [], date: '', memo: '' };
    }
    travelRecords[selectedCountryId].memo = e.target.value;
    saveRecords();
  });

  // 7. 검색 기능
  const searchInput = document.getElementById('search-input');
  const searchDropdown = document.getElementById('search-dropdown');

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) {
      searchDropdown.classList.add('hidden');
      return;
    }

    const matches = [];
    Object.entries(COUNTRIES_DATA).forEach(([id, info]) => {
      let score = 0;
      let matchType = '';

      if (info.name.toLowerCase().includes(q)) {
        score = 10;
        matchType = '국가명 일치';
      } else if (info.nameEn && info.nameEn.toLowerCase().includes(q)) {
        score = 8;
        matchType = '영문명 일치';
      } else if (info.capital && info.capital.toLowerCase().includes(q)) {
        score = 6;
        matchType = `수도: ${info.capital}`;
      } else {
        const matchedSpot = (info.landmarks || []).find(s => s.toLowerCase().includes(q));
        if (matchedSpot) {
          score = 4;
          matchType = `명소: ${matchedSpot}`;
        }
      }

      if (score > 0) {
        matches.push({ id, info, score, matchType });
      }
    });

    matches.sort((a, b) => b.score - a.score);

    if (!matches.length) {
      searchDropdown.innerHTML = '<div style="padding:12px;color:#9ca3af;font-size:0.8rem;">검색 결과가 없습니다.</div>';
      searchDropdown.classList.remove('hidden');
      return;
    }

    searchDropdown.innerHTML = '';
    matches.slice(0, 10).forEach(m => {
      const item = document.createElement('div');
      item.className = 'search-item';
      item.innerHTML = `
        <div class="search-item-title">
          <span>${m.info.flag || '🌐'}</span>
          <strong>${m.info.name}</strong>
          <span style="font-size:0.72rem;color:#9ca3af;">(${m.info.nameEn})</span>
        </div>
        <div class="search-item-sub">${m.matchType}</div>
      `;
      item.addEventListener('click', () => {
        searchDropdown.classList.add('hidden');
        searchInput.value = '';
        openCountryDrawer(m.id);
      });
      searchDropdown.appendChild(item);
    });

    searchDropdown.classList.remove('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !searchDropdown.contains(e.target)) {
      searchDropdown.classList.add('hidden');
    }
  });

  // 8. 🎲 어디 갈까? 랜덤 추천기
  document.getElementById('btn-random').addEventListener('click', () => {
    const unvisited = Object.keys(COUNTRIES_DATA).filter(id => {
      const rec = travelRecords[id];
      return !rec || !rec.status || rec.status === 'unvisited';
    });

    if (!unvisited.length) {
      alert('축하합니다! 전 세계 195개국을 모두 방문하셨습니다! 🥳');
      return;
    }

    const randId = unvisited[Math.floor(Math.random() * unvisited.length)];
    openCountryDrawer(randId);
  });

  // 9. 🏷️ 국명 표시 토글
  document.getElementById('btn-toggle-labels').addEventListener('click', () => {
    showLabels = !showLabels;
    gLabels.selectAll('text').style('display', showLabels ? 'block' : 'none');
  });

  // 10. 줌 컨트롤
  document.getElementById('zoom-in').addEventListener('click', () => {
    svg.transition().duration(300).call(zoom.scaleBy, 1.4);
  });
  document.getElementById('zoom-out').addEventListener('click', () => {
    svg.transition().duration(300).call(zoom.scaleBy, 0.7);
  });
  document.getElementById('zoom-reset').addEventListener('click', () => {
    svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity);
  });

  // 11. 대륙별 필터 칩
  document.querySelectorAll('.filter-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chips .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');

      const filter = chip.getAttribute('data-filter');
      currentFilter = filter;

      gCountries.selectAll('.country-path')
        .transition()
        .duration(300)
        .style('opacity', d => {
          if (filter === 'all') return 1;
          const info = COUNTRIES_DATA[d.id];
          const rec = travelRecords[d.id];

          if (filter === 'visited-only') {
            return (rec && (rec.status === 'visited' || rec.status === 'living')) ? 1 : 0.15;
          }

          return (info && info.continent === filter) ? 1 : 0.15;
        });
    });
  });

  // 12. 백업/복원 모달
  const backupModal = document.getElementById('backup-modal');
  document.getElementById('btn-backup-modal').addEventListener('click', () => {
    backupModal.classList.remove('hidden');
  });
  document.getElementById('btn-close-modal').addEventListener('click', () => {
    backupModal.classList.add('hidden');
  });
  backupModal.addEventListener('click', (e) => {
    if (e.target === backupModal) backupModal.classList.add('hidden');
  });

  // JSON 다운로드
  document.getElementById('btn-download-json').addEventListener('click', () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(travelRecords, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute("href", dataStr);
    dlAnchor.setAttribute("download", `world-travel-map-backup-${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();
  });

  // JSON 파일 불러오기
  document.getElementById('json-file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        if (typeof parsed === 'object') {
          travelRecords = parsed;
          saveRecords();
          alert('여행 기록 데이터를 성공적으로 복원했습니다!');
          backupModal.classList.add('hidden');
        }
      } catch (err) {
        alert('올바른 JSON 백업 파일이 아닙니다.');
      }
    };
    reader.readAsText(file);
  });

  // 데이터 초기화
  document.getElementById('btn-reset-data').addEventListener('click', () => {
    if (confirm('정말로 모든 세계 여행 기록을 초기화하시겠습니까? (되돌릴 수 없습니다)')) {
      travelRecords = {};
      saveRecords();
      backupModal.classList.add('hidden');
      alert('모든 여행 기록이 초기화되었습니다.');
    }
  });

  // 13. 📸 고화질 지도 이미지 내보내기 (PNG)
  document.getElementById('btn-export-image').addEventListener('click', exportMapAsImage);
}

/**
 * 고화질 PNG 지도 다운로드
 */
function exportMapAsImage() {
  const svgElement = document.getElementById('world-map-svg');
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(svgElement);

  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d');

  // 배경 어둡게 채우기
  ctx.fillStyle = '#0a0e17';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const img = new Image();
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  img.onload = () => {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // 하단 워터마크 추가
    ctx.font = 'bold 20px Pretendard, sans-serif';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText('나의 세계 여행 지도 (World Travel Map)', 40, canvas.height - 40);

    const a = document.createElement('a');
    a.download = `my-world-travel-map-${new Date().toISOString().slice(0,10)}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
    URL.revokeObjectURL(url);
  };

  img.src = url;
}
