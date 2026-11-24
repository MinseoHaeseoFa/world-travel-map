/**
 * 세계 여행 지도 (World Travel Map) v2.5
 * 전 세계 195개국 10대 대표 도시 & 10선 랜드마크 아카이브
 * - 명소 개별 삭제(✕) 기능 탑재
 * - 상단 수도/화폐/등급 초슬림 컴팩트 레이아웃
 * - 맨 하단 안심 💾 [여행 기록 저장 완료] 버튼 및 토스트 알림
 */

// 로컬 스토리지 키
const STORAGE_KEY = 'world_travel_records_v2';

// 상태 관리
let travelRecords = {};
let selectedCountryId = null;
let activeCityName = null;
let showLabels = true;
let currentFilter = 'all';
let toastTimeout = null;

// DOM 요소
const svg = d3.select('#world-map-svg');
const tooltip = document.getElementById('hover-tooltip');
const drawer = document.getElementById('detail-drawer');
const toast = document.getElementById('toast-message');

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
  // 자동 시트 연동: 앱 시작 시 항상 구글 시트 최신 기록과 동기화 (PC↔모바일 불일치 방지)
  syncWorldPullFromSheet(false);
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
 * 토스트 메시지 출력
 */
function showToast(message) {
  if (toastTimeout) clearTimeout(toastTimeout);
  document.getElementById('toast-text').textContent = message;
  toast.classList.remove('hidden');

  toastTimeout = setTimeout(() => {
    toast.classList.add('hidden');
  }, 2500);
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
    cities: {}
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

  // 대표 이미지가 등록된 국가는 "국가명 / 등급 + 사진"만 깔끔하게 표시
  updateTooltipPhoto(rec && rec.imageUrl);

  const landmarksUl = document.getElementById('tt-landmarks-list');
  landmarksUl.innerHTML = '';

  const citiesObj = info.cities || {};
  const cityNames = Object.keys(citiesObj);

  if (cityNames.length > 1) {
    cityNames.slice(0, 3).forEach(cityName => {
      const spots = citiesObj[cityName] || [];
      const li = document.createElement('li');
      li.innerHTML = `• <b>${cityName}</b>: ${spots.slice(0, 2).join(', ')}`;
      landmarksUl.appendChild(li);
    });
  } else if (cityNames.length === 1) {
    const singleCity = cityNames[0];
    const spots = citiesObj[singleCity] || [];
    spots.slice(0, 3).forEach(spot => {
      const li = document.createElement('li');
      li.textContent = `• ${spot}`;
      landmarksUl.appendChild(li);
    });
  }

  tooltip.classList.remove('hidden');
}

function handleMouseMove(event) {
  const viewport = document.getElementById('map-viewport').getBoundingClientRect();
  const ttW = tooltip.offsetWidth || 250;
  const ttH = tooltip.offsetHeight || 200;

  const x = event.clientX - viewport.left + 15;
  const y = event.clientY - viewport.top + 15;

  const maxW = Math.max(8, viewport.width - ttW - 8);
  const maxH = Math.max(8, viewport.height - ttH - 8);

  tooltip.style.left = `${Math.max(8, Math.min(x, maxW))}px`;
  tooltip.style.top = `${Math.max(8, Math.min(y, maxH))}px`;
}

// 호버 팝업 대표 이미지: 마우스를 올린 순간에만 1장 로드 (온디맨드 지연 로딩)
function updateTooltipPhoto(imageUrl) {
  const wrap = document.getElementById('tt-photo-wrap');
  const img = document.getElementById('tt-photo');
  if (!wrap || !img) return;

  const url = (typeof imageUrl === 'string') ? imageUrl.trim() : '';
  if (url) {
    // 컨테이너를 먼저 보이게 한 뒤에 src를 넣어야 숨김 상태에서 로드가 취소되지 않는다
    wrap.style.display = 'block';
    tooltip.classList.add('has-photo');
    img.onerror = () => {
      const alt = photoAlternateUrl(url);
      if (alt && img.getAttribute('src') !== alt) { img.src = alt; return; }
      wrap.style.display = 'none';
      tooltip.classList.remove('has-photo');
    };
    if (img.getAttribute('data-src') !== url) {
      img.setAttribute('data-src', url);
      img.src = url;
    }
  } else {
    wrap.style.display = 'none';
    tooltip.classList.remove('has-photo');
    img.removeAttribute('data-src');
  }
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

  if (!travelRecords[countryId]) {
    travelRecords[countryId] = { status: null, citySpots: {}, customCities: {}, deletedSpots: {}, date: '', memo: '' };
  }
  const rec = travelRecords[countryId];
  if (!rec.citySpots) rec.citySpots = {};
  if (!rec.customCities) rec.customCities = {};
  if (!rec.deletedSpots) rec.deletedSpots = {};

  // 상태 태그 및 버튼 활성화
  updateDrawerStatusUI(rec.status);

  // 도시 칩 목록 렌더링 & 첫 번째 도시 활성화
  renderCitiesChips(info, rec);

  // 날짜 & 메모
  document.getElementById('visit-date-input').value = rec.date || '';
  document.getElementById('travel-memo').value = rec.memo || '';

  renderPhotoCard(rec.imageUrl || '');

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
  activeCityName = null;
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
  const translate = [width / 2 - scale * x - 120, height / 2 - scale * y];

  svg.transition()
    .duration(750)
    .call(zoom.transform, d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale));
}

/**
 * 서랍 내 방문 상태 UI 갱신 (초슬림 알약 형태)
 */
function updateDrawerStatusUI(status) {
  const tag = document.getElementById('current-status-tag');
  const buttons = document.querySelectorAll('.status-btn-pill');

  buttons.forEach(b => b.classList.remove('active'));

  if (!status) {
    tag.className = 'meta-pill status-pill-none';
    tag.textContent = '⬜ 미방문';
    return;
  }

  const activeBtn = document.querySelector(`.status-btn-pill[data-status="${status}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  tag.className = `meta-pill status-pill-${status}`;
  if (status === 'visited') tag.textContent = '🟢 방문 완료';
  else if (status === 'living') tag.textContent = '✈️ 체류·거주';
  else if (status === 'bucket') tag.textContent = '🌟 버킷리스트';
}

/**
 * 🏙️ 도시 칩 목록 렌더링
 */
function renderCitiesChips(info, rec) {
  const container = document.getElementById('cities-chip-container');
  container.innerHTML = '';

  const defaultCities = info.cities || {};
  const customCities = rec.customCities || {};
  const allCitiesMap = { ...defaultCities, ...customCities };
  const cityNames = Object.keys(allCitiesMap);

  if (!cityNames.length) {
    const defaultCity = info.capital || '대표 도시';
    allCitiesMap[defaultCity] = info.landmarks || [];
    cityNames.push(defaultCity);
  }

  // 기본 활성 도시 설정
  if (!activeCityName || !allCitiesMap[activeCityName]) {
    activeCityName = cityNames[0];
  }

  let visitedCitiesCount = 0;

  cityNames.forEach(cityName => {
    const rawSpots = allCitiesMap[cityName] || [];
    const deletedSet = new Set(rec.deletedSpots[cityName] || []);
    const validSpots = rawSpots.filter(s => !deletedSet.has(s));

    const checkedSpots = (rec.citySpots[cityName] || []).filter(s => !deletedSet.has(s));
    const isVisited = checkedSpots.length > 0;
    if (isVisited) visitedCitiesCount++;

    const chip = document.createElement('button');
    chip.className = `city-chip ${cityName === activeCityName ? 'active' : ''}`;
    chip.innerHTML = `
      <span>${cityName}</span>
      <span class="city-chip-count">${checkedSpots.length}/${validSpots.length}</span>
    `;

    chip.addEventListener('click', () => {
      activeCityName = cityName;
      renderCitiesChips(info, rec);
      renderLandmarksForCity(cityName, validSpots, rec);
    });

    container.appendChild(chip);
  });

  // + 도시 추가 버튼
  const addBtn = document.createElement('button');
  addBtn.className = 'btn-add-city';
  addBtn.textContent = '+ 도시 추가';
  addBtn.addEventListener('click', () => {
    const newCity = prompt(`[${info.name}]에 추가할 새로운 도시 이름을 입력하세요:`);
    if (newCity && newCity.trim()) {
      const trimmed = newCity.trim();
      if (!rec.customCities) rec.customCities = {};
      if (!rec.customCities[trimmed]) {
        rec.customCities[trimmed] = [`${trimmed} 대표 거리`, `${trimmed} 중심지 & 전망대`];
      }
      activeCityName = trimmed;
      saveRecords();
      renderCitiesChips(info, rec);
      renderLandmarksForCity(trimmed, rec.customCities[trimmed], rec);
    }
  });
  container.appendChild(addBtn);

  document.getElementById('cities-counter').textContent = `(${visitedCitiesCount}/${cityNames.length}개 도시 방문)`;

  // 현재 활성 도시의 랜드마크 렌더링
  const rawActiveSpots = allCitiesMap[activeCityName] || [];
  const deletedActiveSet = new Set(rec.deletedSpots[activeCityName] || []);
  const validActiveSpots = rawActiveSpots.filter(s => !deletedActiveSet.has(s));

  renderLandmarksForCity(activeCityName, validActiveSpots, rec);
}

/**
 * 📍 선택된 도시의 랜드마크 체크리스트 렌더링 (삭제 기능 포함)
 */
function renderLandmarksForCity(cityName, spots, rec) {
  document.getElementById('current-city-name').textContent = cityName;
  const container = document.getElementById('landmarks-list');
  container.innerHTML = '';

  const checkedSpots = new Set((rec.citySpots[cityName] || []));

  if (!spots.length) {
    container.innerHTML = '<div style="padding:16px;text-align:center;color:#94a3b8;font-size:0.78rem;">등록된 랜드마크가 없습니다. 아래에서 명소를 추가하거나 상단 [명소 초기화]를 눌러보세요.</div>';
    updateSpotsCounter(0, 0);
    return;
  }

  spots.forEach(spotName => {
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

    // 우측 액션 그룹 (지도 + 삭제 ✕)
    const rightActions = document.createElement('div');
    rightActions.className = 'spot-right-actions';

    // 구글 지도 검색 링크
    const countryName = COUNTRIES_DATA[selectedCountryId].name;
    const mapLink = document.createElement('a');
    mapLink.className = 'spot-map-link';
    mapLink.href = `https://www.google.com/maps/search/${encodeURIComponent(countryName + ' ' + cityName + ' ' + spotName)}`;
    mapLink.target = '_blank';
    mapLink.rel = 'noopener';
    mapLink.textContent = '🗺️ 지도';
    mapLink.title = '구글 지도에서 위치 확인';
    mapLink.onclick = (e) => e.stopPropagation();

    // [개선 3] 랜드마크 개별 삭제 버튼
    const delBtn = document.createElement('button');
    delBtn.className = 'spot-del-btn';
    delBtn.textContent = '✕';
    delBtn.title = '이 랜드마크 목록에서 삭제';
    delBtn.onclick = (e) => {
      e.stopPropagation();
      deleteSpot(cityName, spotName);
    };

    rightActions.appendChild(mapLink);
    rightActions.appendChild(delBtn);

    item.appendChild(left);
    item.appendChild(rightActions);

    item.addEventListener('click', () => {
      checkbox.checked = !checkbox.checked;
      toggleCitySpot(cityName, spotName, checkbox.checked);
    });

    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCitySpot(cityName, spotName, checkbox.checked);
    });

    container.appendChild(item);
  });

  const validCheckedCount = spots.filter(s => checkedSpots.has(s)).length;
  updateSpotsCounter(validCheckedCount, spots.length);
}

/**
 * 랜드마크 개별 삭제 처리
 */
function deleteSpot(cityName, spotName) {
  if (!selectedCountryId) return;
  const rec = travelRecords[selectedCountryId];
  if (!rec) return;

  // 1. 체크된 목록에서 제거
  if (rec.citySpots[cityName]) {
    rec.citySpots[cityName] = rec.citySpots[cityName].filter(s => s !== spotName);
  }

  // 2. 커스텀 명소라면 커스텀 배열에서 제거
  if (rec.customCities && rec.customCities[cityName]) {
    rec.customCities[cityName] = rec.customCities[cityName].filter(s => s !== spotName);
  }

  // 3. 기본 명소라면 deletedSpots에 추가
  if (!rec.deletedSpots) rec.deletedSpots = {};
  if (!rec.deletedSpots[cityName]) rec.deletedSpots[cityName] = [];
  if (!rec.deletedSpots[cityName].includes(spotName)) {
    rec.deletedSpots[cityName].push(spotName);
  }

  saveRecords();
  renderCitiesChips(COUNTRIES_DATA[selectedCountryId], rec);
}

/**
 * 도시 내 랜드마크 토글
 */
function toggleCitySpot(cityName, spotName, isChecked) {
  if (!selectedCountryId) return;

  const rec = travelRecords[selectedCountryId];
  if (!rec.citySpots) rec.citySpots = {};
  if (!rec.citySpots[cityName]) rec.citySpots[cityName] = [];

  if (isChecked) {
    if (!rec.citySpots[cityName].includes(spotName)) {
      rec.citySpots[cityName].push(spotName);
    }
    // 명소 체크 시 국가 상태를 자동으로 '방문 완료'로 격상
    if (!rec.status) {
      rec.status = 'visited';
      updateDrawerStatusUI('visited');
    }
  } else {
    rec.citySpots[cityName] = rec.citySpots[cityName].filter(s => s !== spotName);
  }

  saveRecords();

  const info = COUNTRIES_DATA[selectedCountryId];
  renderCitiesChips(info, rec);
}

function updateSpotsCounter(checked, total) {
  document.getElementById('spots-counter').textContent = `(${checked}/${total} 완료)`;
}

/**
 * 종합 통계 갱신
 */
function updateStats() {
  const total = 195; // 공식 UN 기준 195개국

  let visitedCount = 0;
  let livingCount = 0;
  let bucketCount = 0;
  let totalLandmarks = 0;

  Object.values(travelRecords).forEach(rec => {
    if (rec.status === 'visited') visitedCount++;
    else if (rec.status === 'living') livingCount++;
    else if (rec.status === 'bucket') bucketCount++;

    if (rec.citySpots) {
      Object.entries(rec.citySpots).forEach(([cName, spots]) => {
        const deletedSet = new Set((rec.deletedSpots && rec.deletedSpots[cName]) || []);
        const validSpots = spots.filter(s => !deletedSet.has(s));
        totalLandmarks += validSpots.length;
      });
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

  // 1-1. 대표 이미지 (Trail Log Photos)
  setupPhotoCard();

  // 2. 방문 등급 콤팩트 버튼 클릭
  document.querySelectorAll('.status-btn-pill[data-status]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!selectedCountryId) return;
      const status = btn.getAttribute('data-status');

      if (!travelRecords[selectedCountryId]) {
        travelRecords[selectedCountryId] = { status: null, citySpots: {}, customCities: {}, deletedSpots: {}, date: '', memo: '' };
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

  // 4. 활성 도시 명소 모두 선택 / 모두 해제 / 기본 명소 초기화
  document.getElementById('btn-select-all-spots').addEventListener('click', () => {
    if (!selectedCountryId || !activeCityName) return;
    const info = COUNTRIES_DATA[selectedCountryId];
    const rec = travelRecords[selectedCountryId];

    const allCitiesMap = { ...(info.cities || {}), ...(rec.customCities || {}) };
    const rawSpots = allCitiesMap[activeCityName] || [];
    const deletedSet = new Set(rec.deletedSpots[activeCityName] || []);
    const validSpots = rawSpots.filter(s => !deletedSet.has(s));

    if (!rec.citySpots) rec.citySpots = {};
    rec.citySpots[activeCityName] = [...validSpots];

    if (!rec.status) {
      rec.status = 'visited';
      updateDrawerStatusUI('visited');
    }

    saveRecords();
    renderCitiesChips(info, rec);
  });

  document.getElementById('btn-deselect-all-spots').addEventListener('click', () => {
    if (!selectedCountryId || !activeCityName) return;
    const rec = travelRecords[selectedCountryId];
    if (rec.citySpots && rec.citySpots[activeCityName]) {
      rec.citySpots[activeCityName] = [];
      saveRecords();
      renderCitiesChips(COUNTRIES_DATA[selectedCountryId], rec);
    }
  });

  document.getElementById('btn-reset-default-spots').addEventListener('click', () => {
    if (!selectedCountryId || !activeCityName) return;
    const rec = travelRecords[selectedCountryId];
    if (rec.deletedSpots && rec.deletedSpots[activeCityName]) {
      delete rec.deletedSpots[activeCityName];
      saveRecords();
      renderCitiesChips(COUNTRIES_DATA[selectedCountryId], rec);
      showToast(`[${activeCityName}] 기본 랜드마크가 복원되었습니다! 🔄`);
    }
  });

  // 5. 활성 도시에 나만의 명소 추가
  document.getElementById('btn-add-custom-spot').addEventListener('click', addCustomSpot);
  document.getElementById('custom-spot-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addCustomSpot();
  });

  function addCustomSpot() {
    if (!selectedCountryId || !activeCityName) return;
    const input = document.getElementById('custom-spot-input');
    const val = input.value.trim();
    if (!val) return;

    const rec = travelRecords[selectedCountryId];
    const info = COUNTRIES_DATA[selectedCountryId];

    if (!rec.customCities) rec.customCities = {};
    if (!rec.customCities[activeCityName]) {
      rec.customCities[activeCityName] = [];
    }

    if (!rec.customCities[activeCityName].includes(val)) {
      rec.customCities[activeCityName].push(val);
      if (!rec.citySpots[activeCityName]) rec.citySpots[activeCityName] = [];
      rec.citySpots[activeCityName].push(val); // 자동 체크
      saveRecords();
      renderCitiesChips(info, rec);
      input.value = '';
    }
  }

  // 6. 방문 일자 & 메모 자동 저장
  document.getElementById('visit-date-input').addEventListener('input', (e) => {
    if (!selectedCountryId) return;
    if (!travelRecords[selectedCountryId]) {
      travelRecords[selectedCountryId] = { status: 'visited', citySpots: {}, customCities: {}, deletedSpots: {}, date: '', memo: '' };
    }
    travelRecords[selectedCountryId].date = e.target.value;
    saveRecords();
  });

  document.getElementById('travel-memo').addEventListener('input', (e) => {
    if (!selectedCountryId) return;
    if (!travelRecords[selectedCountryId]) {
      travelRecords[selectedCountryId] = { status: 'visited', citySpots: {}, customCities: {}, deletedSpots: {}, date: '', memo: '' };
    }
    travelRecords[selectedCountryId].memo = e.target.value;
    saveRecords();
  });

  // [개선 5] 맨 하단 안심 💾 [여행 기록 저장 완료] 버튼
  const saveBtn = document.getElementById('btn-save-confirm');
  saveBtn.addEventListener('click', () => {
    if (!selectedCountryId) return;
    const info = COUNTRIES_DATA[selectedCountryId];
    const countryName = info ? info.name : '해당 국가';

    // 현재 텍스트 값 최종 확인 및 저장
    if (!travelRecords[selectedCountryId]) {
      travelRecords[selectedCountryId] = { status: 'visited', citySpots: {}, customCities: {}, deletedSpots: {}, date: '', memo: '' };
    }
    travelRecords[selectedCountryId].date = document.getElementById('visit-date-input').value;
    travelRecords[selectedCountryId].memo = document.getElementById('travel-memo').value;

    saveRecords();

    // 버튼 피드백 애니메이션
    saveBtn.classList.add('saved-success');
    const originalHtml = saveBtn.innerHTML;
    saveBtn.innerHTML = '<span class="save-icon">✓</span><span class="save-text">저장 완료!</span>';

    setTimeout(() => {
      saveBtn.classList.remove('saved-success');
      saveBtn.innerHTML = originalHtml;
    }, 1500);

    // 안심 토스트 출력
    showToast(`✅ [${countryName}] 여행 기록이 안전하게 저장되었습니다! 💾`);
  });

  // 7. 검색 기능 (국가명, 영문명, 수도, 도시, 명소 모두 실시간 검색)
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
        score = 7;
        matchType = `수도: ${info.capital}`;
      } else {
        const cities = info.cities || {};
        for (const [cName, spots] of Object.entries(cities)) {
          if (cName.toLowerCase().includes(q)) {
            score = 6;
            matchType = `도시: ${cName}`;
            break;
          }
          const matchedSpot = spots.find(s => s.toLowerCase().includes(q));
          if (matchedSpot) {
            score = 5;
            matchType = `${cName} 명소: ${matchedSpot}`;
            break;
          }
        }
      }

      if (score > 0) {
        matches.push({ id, info, score, matchType });
      }
    });

    matches.sort((a, b) => b.score - a.score);

    if (!matches.length) {
      searchDropdown.innerHTML = '<div style="padding:12px;color:#64748b;font-size:0.8rem;">검색 결과가 없습니다.</div>';
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
          <span style="font-size:0.72rem;color:#64748b;">(${m.info.nameEn})</span>
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

  // 구글 시트 동기화 버튼 연동
  const btnHeaderSync = document.getElementById('btn-header-sync');
  if (btnHeaderSync) {
    btnHeaderSync.addEventListener('click', () => {
      backupModal.classList.remove('hidden');
    });
  }

  const btnSyncPull = document.getElementById('btn-sync-pull');
  if (btnSyncPull) {
    btnSyncPull.addEventListener('click', () => syncWorldPullFromSheet(true));
  }

  const btnSyncPush = document.getElementById('btn-sync-push');
  if (btnSyncPush) {
    btnSyncPush.addEventListener('click', () => syncWorldPushToSheet());
  }

  // 13. 📸 고화질 PNG 지도 다운로드
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

  // 청명한 바다빛 배경 채우기
  ctx.fillStyle = '#dbeafe';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const img = new Image();
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  img.onload = () => {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // 하단 워터마크 추가
    ctx.font = 'bold 22px Pretendard, sans-serif';
    ctx.fillStyle = '#1e3a8a';
    ctx.fillText('나의 세계 여행 Trail Log', 40, canvas.height - 40);

    const a = document.createElement('a');
    a.download = `나의_세계_여행_Trail_Log_${new Date().toISOString().slice(0,10)}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
    URL.revokeObjectURL(url);
  };

  img.src = url;
}

// --- Google Sheet Real-time Sync for World Map ---
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwylu_1JxOFwI66iI3X0Fc7IQz7PiA5zJKjrjZkvNF1XzPKVzmvLZSHnB-bilwVdawE/exec';

async function syncWorldPullFromSheet(showFeedback = true) {
  const statusEl = document.getElementById('sync-status');
  if (statusEl && showFeedback) {
    statusEl.style.display = 'block';
    statusEl.style.color = '#2563eb';
    statusEl.textContent = '⏳ 구글 시트에서 최신 세계 여행 기록을 불러오는 중...';
  }
  try {
    const res = await fetch(`${GOOGLE_SCRIPT_URL}?action=world&_t=${Date.now()}`, { cache: 'no-store' });
    const json = await res.json();
    if (json && json.world) {
      const incoming = json.world;
      const count = Object.keys(incoming).length;
      if (count === 0) {
        if (statusEl && showFeedback) {
          statusEl.style.display = 'block';
          statusEl.style.color = '#64748b';
          statusEl.textContent = 'ℹ️ 구글 시트에 아직 저장된 방문 기록이 없습니다.';
        }
        return;
      }
      // 구글 시트를 단일 기준(SSOT)으로 삼아 기존 로컬 캐시 잔여 기록 완전 교체
      travelRecords = {};
      Object.keys(incoming).forEach(code => {
        const item = incoming[code];
        if (!travelRecords[code]) {
          travelRecords[code] = { status: null, citySpots: {}, customCities: {}, deletedSpots: {}, date: '', memo: '' };
        }
        const rec = travelRecords[code];
        rec.status = item.status || null;
        rec.date = item.date || item.visitedDate || '';
        rec.customCities = item.customCities || {};
        rec.citySpots = item.citySpots || {};
        rec.memo = item.memo || '';
        rec.imageUrl = item.imageUrl || '';
      });
      saveRecords();
      updateMapColors();
      updateStats();
      if (statusEl && showFeedback) {
        statusEl.style.display = 'block';
        statusEl.style.color = '#059669';
        statusEl.textContent = `✅ 구글 시트에서 ${count}개국 기록을 성공적으로 불러왔습니다!`;
      }
    }
  } catch (err) {
    console.error('World sync pull failed:', err);
    if (statusEl && showFeedback) {
      statusEl.style.display = 'block';
      statusEl.style.color = '#dc2626';
      statusEl.textContent = '❌ 동기화 실패: 네트워크 상태를 확인해 주세요.';
    }
  }
}

async function syncWorldPushToSheet() {
  const statusEl = document.getElementById('sync-status');
  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.style.color = '#2563eb';
    statusEl.textContent = '⏳ 구글 시트로 현재 세계 여행 기록을 저장하는 중...';
  }
  try {
    const count = Object.keys(travelRecords).length;
    const dataToSend = {};
    Object.keys(travelRecords).forEach(code => {
      const r = travelRecords[code];
      const item = {
        status: r.status || '미방문',
        date: r.date || r.visitedDate || '',
        customCities: r.customCities || {},
        citySpots: r.citySpots || {},
        memo: r.memo || ''
      };
      // imageUrl 값을 알고 있는 경우에만 전송 (모르는 상태에서 사진을 지우지 않도록)
      if (Object.prototype.hasOwnProperty.call(r, 'imageUrl')) {
        item.imageUrl = r.imageUrl || '';
      }
      dataToSend[code] = item;
    });
    // 🔒 쓰기는 주인장 PIN이 필요합니다. (구경·불러오기는 그대로 자유)
    const result = await OwnerPin.post(GOOGLE_SCRIPT_URL, (pin) => ({
      type: 'world',
      data: dataToSend,
      pin: pin
    }));
    if (result.cancelled) {
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.color = '#b45309';
        statusEl.textContent = result.unauthorized
          ? '🔒 PIN 인증에 실패해 저장하지 않았습니다.'
          : '🔒 주인장 PIN 입력이 취소되어 저장하지 않았습니다.';
      }
      return;
    }
    const json = result.json;
    if (json && json.status === 'ok') {
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.color = '#059669';
        statusEl.textContent = `✅ 구글 시트에 ${count}개국 기록을 저장했습니다! (PC·모바일 동기화 완료)`;
      }
    } else {
      throw new Error((json && json.message) || '저장 실패');
    }
  } catch (err) {
    console.error('World sync push failed:', err);
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.style.color = '#dc2626';
      statusEl.textContent = '❌ 저장 실패: 잠시 후 다시 시도해 주세요.';
    }
  }
}

/* ==========================================================================
   대표 이미지 (Trail Log Photos)
   브라우저에서 600px·30~50KB로 자동 압축 → Google Drive 저장 → 시트 ImageUrl 동기화
   ========================================================================== */
const PHOTO_SCOPE = 'world';
const PHOTO_FOLDER_NAME = 'Trail Log Photos';
const PHOTO_EMPTY_TEXT = '이 나라의 기억을 사진 한 장으로 남겨 보세요';
const PHOTO_MAX_WIDTH = 600;
const PHOTO_TARGET_BYTES = 50 * 1024;
const PHOTO_REDEPLOY_MSG = '구글 시트 Apps Script를 v3 새 버전으로 재배포하면 사진이 저장됩니다';

const PHOTO_DRIVE_AUTH_HINT = ' — Apps Script에서 authorizeDrive를 1회 실행해 드라이브 권한을 승인해 주세요.';
const PHOTO_DRIVE_AUTH_MSG = '드라이브 권한 승인이 필요합니다. Apps Script 편집기 → 함수 [authorizeDrive] → [▷ 실행] → [권한 검토] → [허용] 후 다시 시도해 주세요.';

// 서버(Apps Script)가 돌려준 실제 오류 사유를 화면에 보여 주기 위한 정리 함수
// (드라이브 권한 미승인은 원인과 해결법이 분명하므로 짧은 안내로 바꿔 보여 준다)
function photoServerErrorMessage(message) {
  const msg = String(message || '').replace(/^(Error|Exception):\s*/i, '').trim();
  if (!msg) return PHOTO_REDEPLOY_MSG;
  if (/DriveApp\.getFoldersByName|drive\.readonly|auth\/drive|permission to call DriveApp|호출할 수 있는 권한이 없습니다/i.test(msg)) {
    return PHOTO_DRIVE_AUTH_MSG;
  }
  if (/drive|permission|권한|승인|authoriz/i.test(msg)) {
    return msg + PHOTO_DRIVE_AUTH_HINT;
  }
  return msg;
}

let photoBusy = false;
let photoStatusTimer = null;
let webpSupport = null;

function supportsWebp() {
  if (webpSupport !== null) return webpSupport;
  try {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    webpSupport = c.toDataURL('image/webp').indexOf('data:image/webp') === 0;
  } catch (e) {
    webpSupport = false;
  }
  return webpSupport;
}

// Drive 썸네일이 일시적으로 실패하면 lh3 직접 주소로 한 번 더 시도
function photoAlternateUrl(url) {
  const m = String(url || '').match(/[?&]id=([\w-]+)/);
  if (!m) return '';
  return 'https://lh3.googleusercontent.com/d/' + m[1] + '=w800';
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    fr.readAsDataURL(file);
  });
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 열지 못했습니다. 다른 사진으로 시도해 주세요.'));
    img.src = src;
  });
}

function estimateDataUrlBytes(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const b64 = comma > -1 ? dataUrl.substring(comma + 1) : dataUrl;
  const padding = b64.endsWith('==') ? 2 : (b64.endsWith('=') ? 1 : 0);
  return Math.floor((b64.length * 3) / 4) - padding;
}

async function compressTrailPhoto(file) {
  if (!file || !file.type || file.type.indexOf('image/') !== 0) {
    throw new Error('사진 파일(이미지)만 등록할 수 있습니다.');
  }
  const dataUrl = await readFileAsDataURL(file);
  const img = await loadImageElement(dataUrl);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (!srcW || !srcH) throw new Error('이미지 크기를 읽을 수 없습니다.');

  const mime = supportsWebp() ? 'image/webp' : 'image/jpeg';
  let width = Math.min(PHOTO_MAX_WIDTH, srcW);
  let quality = 0.82;
  let out = '';

  for (let i = 0; i < 8; i++) {
    const height = Math.max(1, Math.round((srcH * width) / srcW));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    out = canvas.toDataURL(mime, quality);

    if (estimateDataUrlBytes(out) <= PHOTO_TARGET_BYTES) break;
    if (quality > 0.6) {
      quality = Math.max(0.6, quality - 0.06);
    } else {
      width = width * 0.85;
      quality = 0.78;
    }
  }

  const bytes = estimateDataUrlBytes(out);
  const base64 = out.substring(out.indexOf(',') + 1);
  const ext = mime === 'image/webp' ? 'webp' : 'jpg';
  return {
    base64: base64,
    mimeType: mime,
    bytes: bytes,
    fileName: `traillog-world-${Date.now()}.${ext}`
  };
}

function setPhotoStatus(message, kind) {
  const el = document.getElementById('photo-status');
  if (!el) return;
  if (photoStatusTimer) clearTimeout(photoStatusTimer);
  el.className = 'photo-status' + (message ? ' show' : '');
  if (kind === 'ok') el.classList.add('ok');
  if (kind === 'error') el.classList.add('error');
  el.textContent = message || '';
  if (message) {
    photoStatusTimer = setTimeout(() => {
      el.className = 'photo-status';
      el.textContent = '';
    }, 8000);
  }
}

function renderPhotoCard(imageUrl) {
  const frame = document.getElementById('photo-frame');
  const img = document.getElementById('photo-img');
  const empty = document.getElementById('photo-empty');
  const btnUpload = document.getElementById('btn-photo-upload');
  const btnDelete = document.getElementById('btn-photo-delete');
  if (!frame || !img) return;

  const url = (typeof imageUrl === 'string') ? imageUrl.trim() : '';
  const emptyText = empty ? empty.querySelector('.photo-empty-text') : null;
  if (url) {
    if (emptyText) emptyText.textContent = PHOTO_EMPTY_TEXT;
    // 컨테이너를 먼저 보이게 한 뒤에 src를 넣어야 숨김 상태에서 로드가 취소되지 않는다
    img.style.display = 'block';
    empty.style.display = 'none';
    frame.classList.add('has-photo');
    btnUpload.textContent = '🔄 사진 변경';
    btnDelete.classList.remove('hidden');
    img.onerror = () => {
      const alt = photoAlternateUrl(url);
      if (alt && img.getAttribute('src') !== alt) { img.src = alt; return; }
      img.removeAttribute('src');
      img.style.display = 'none';
      empty.style.display = 'flex';
      frame.classList.remove('has-photo');
      if (emptyText) emptyText.textContent = '사진을 불러오지 못했습니다. [🔄 사진 변경]으로 다시 등록해 주세요.';
    };
    img.src = url;
  } else {
    img.onerror = null;
    img.removeAttribute('src');
    img.style.display = 'none';
    empty.style.display = 'flex';
    frame.classList.remove('has-photo');
    btnUpload.textContent = '📷 대표 사진 등록';
    btnDelete.classList.add('hidden');
  }
}

function setPhotoButtonsDisabled(disabled) {
  const btnUpload = document.getElementById('btn-photo-upload');
  const btnDelete = document.getElementById('btn-photo-delete');
  if (btnUpload) btnUpload.disabled = disabled;
  if (btnDelete) btnDelete.disabled = disabled;
}

async function handlePhotoFileSelected(file) {
  const code = selectedCountryId;
  if (!code || photoBusy) return;

  photoBusy = true;
  setPhotoButtonsDisabled(true);
  setPhotoStatus('⏳ 사진을 가로 600px로 압축해 구글 드라이브에 저장하는 중...', '');

  try {
    const compressed = await compressTrailPhoto(file);
    const payload = {
      action: 'uploadPhoto',
      folderName: PHOTO_FOLDER_NAME,
      fileName: compressed.fileName,
      mimeType: compressed.mimeType,
      base64Data: compressed.base64,
      scope: PHOTO_SCOPE,
      key: String(code)
    };

    // 🔒 사진 업로드는 쓰기이므로 주인장 PIN을 함께 보냅니다.
    const result = await OwnerPin.post(GOOGLE_SCRIPT_URL, (pin) => ({
      action: 'uploadPhoto',
      folderName: payload.folderName,
      fileName: payload.fileName,
      mimeType: payload.mimeType,
      base64Data: payload.base64Data,
      scope: payload.scope,
      key: payload.key,
      pin: pin
    }));
    if (result.cancelled) {
      setPhotoStatus(result.unauthorized
        ? '🔒 PIN 인증에 실패해 사진을 저장하지 않았습니다.'
        : '🔒 주인장 PIN 입력이 취소되어 사진을 저장하지 않았습니다.', 'error');
      return;
    }
    const json = result.json;

    // 서버가 실제 오류 사유를 돌려주면 그 메시지를 그대로 보여 준다
    if (json && json.status === 'error' && json.message) {
      throw new Error(photoServerErrorMessage(json.message));
    }
    // 응답이 JSON이 아니거나(HTML 오류 페이지 등) v3 배포가 아니면 재배포 안내
    if (!json || json.version !== 'v3' || json.status !== 'ok' || !json.imageUrl) {
      throw new Error(PHOTO_REDEPLOY_MSG);
    }

    if (!travelRecords[code]) {
      travelRecords[code] = { status: null, citySpots: {}, customCities: {}, deletedSpots: {}, date: '', memo: '' };
    }
    travelRecords[code].imageUrl = json.imageUrl;
    saveRecords();
    renderPhotoCard(json.imageUrl);
    setPhotoStatus(`✅ 대표 사진 저장 완료 (${Math.round(compressed.bytes / 1024)}KB · 구글 드라이브 'Trail Log Photos')`, 'ok');
  } catch (err) {
    setPhotoStatus('⚠️ ' + (err && err.message ? err.message : '사진 저장에 실패했습니다.'), 'error');
  } finally {
    photoBusy = false;
    setPhotoButtonsDisabled(false);
  }
}

async function handlePhotoDelete() {
  const code = selectedCountryId;
  if (!code || photoBusy) return;
  if (!window.confirm('이 나라의 대표 사진을 삭제할까요? (드라이브 원본은 보관됩니다)')) return;

  photoBusy = true;
  setPhotoButtonsDisabled(true);
  setPhotoStatus('⏳ 대표 사진을 삭제하는 중...', '');

  let serverError = '';
  let pinCancelled = false;
  try {
    // 🔒 사진 삭제(시트 ImageUrl 비우기)는 쓰기이므로 주인장 PIN이 필요합니다.
    const result = await OwnerPin.post(GOOGLE_SCRIPT_URL, (pin) => ({
      action: 'deletePhoto', scope: PHOTO_SCOPE, key: String(code), pin: pin
    }));
    if (result.cancelled) {
      pinCancelled = true;
    } else {
      const json = result.json;
      if (json && json.status === 'error' && json.message) {
        serverError = photoServerErrorMessage(json.message);
      } else if (!json || json.version !== 'v3') {
        serverError = PHOTO_REDEPLOY_MSG;
      }
    }
  } catch (err) {
    serverError = (err && err.message) ? err.message : '네트워크 오류로 구글 시트에 반영하지 못했습니다.';
  }

  if (pinCancelled) {
    setPhotoStatus('🔒 주인장 PIN 인증이 취소되어 사진을 삭제하지 않았습니다.', 'error');
    photoBusy = false;
    setPhotoButtonsDisabled(false);
    return;
  }

  if (travelRecords[code]) {
    travelRecords[code].imageUrl = '';
  }
  saveRecords();
  renderPhotoCard('');
  if (serverError) {
    setPhotoStatus('⚠️ 화면에서는 삭제했지만 구글 시트에는 반영되지 않았습니다: ' + serverError, 'error');
  } else {
    setPhotoStatus('🗑️ 대표 사진을 삭제했습니다. (드라이브 원본은 Trail Log Photos 폴더에 보관)', 'ok');
  }

  photoBusy = false;
  setPhotoButtonsDisabled(false);
}

function setupPhotoCard() {
  const btnUpload = document.getElementById('btn-photo-upload');
  const btnDelete = document.getElementById('btn-photo-delete');
  const fileInput = document.getElementById('photo-file-input');
  if (!btnUpload || !fileInput) return;

  btnUpload.addEventListener('click', () => {
    if (!selectedCountryId || photoBusy) return;
    fileInput.value = '';
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handlePhotoFileSelected(file);
  });

  if (btnDelete) {
    btnDelete.addEventListener('click', handlePhotoDelete);
  }
}
