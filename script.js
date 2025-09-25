const pagination = document.getElementById("pagination");
const searchInput = document.getElementById("search");
const itemsPerPageSelect = document.getElementById("itemsPerPage");
const container = document.getElementById("charactersContainer");

let currentPage = 1;
let itemsPerPage = parseInt(itemsPerPageSelect.value);
let totalPages = 1;

const API_URL = "http://localhost:3001/api/characters";

async function fetchCharacters() {
  try {
    const searchTerm = searchInput.value.trim().toLowerCase();
    const res = await fetch(
      `${API_URL}?page=${currentPage}&limit=${itemsPerPage}&search=${searchTerm}`
    );
    const data = await res.json();


    renderCharacters(data.data); 
    totalPages = data.meta.pages; 
    renderPagination();
  } catch (error) {
    container.innerHTML = "<p>Помилка завантаження персонажів</p>";
    console.error(error);
  }
}

function renderCharacters(characters) {
  container.innerHTML = "";
  characters.forEach((char) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <img src="${char.images?.sm}" alt="${char.name}">
      <h3>${char.name}</h3>
    `;
    card.addEventListener("click", () => fetchCharacterDetail(char.id));
    container.appendChild(card);
  });
}


async function fetchCharacterDetail(id) {
  try {
    const res = await fetch(`${API_URL}/${id}`);
    const char = await res.json();

    container.innerHTML = `
    <button id="backButton">Назад</button>
    <h2>${char.name}</h2>
    <img src="${char.images?.lg}" class="photo" alt="${char.name}">
    <div class="stats">
      <p><span>Інтелект:</span> ${char.powerstats?.intelligence}</p>
      <p class="power"><span>Сила:</span> ${char.powerstats?.strength}</p>
      <p><span>Швидкість:</span> ${char.powerstats?.speed}</p>
      <p><span>Біографія:</span> ${char.biography?.fullName}</p>
    </div>
  `;
  

    document
      .getElementById("backButton")
      .addEventListener("click", () => fetchCharacters());
  } catch (error) {
    container.innerHTML = "<p>Помилка завантаження героя</p>";
    console.error(error);
  }
}

function renderPagination() {
  pagination.innerHTML = "";
  for (let i = 1; i <= totalPages; i++) {
    const btn = document.createElement("button");
    btn.textContent = i;
    if (i === currentPage) btn.disabled = true;
    btn.addEventListener("click", () => {
      currentPage = i;
      fetchCharacters();
    });
    pagination.appendChild(btn);
  }
}

searchInput.addEventListener("input", () => {
  currentPage = 1;
  fetchCharacters();
});

itemsPerPageSelect.addEventListener("change", () => {
  itemsPerPage = parseInt(itemsPerPageSelect.value);
  currentPage = 1;
  fetchCharacters();
});

fetchCharacters();
