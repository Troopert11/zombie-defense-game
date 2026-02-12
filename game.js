/** @type {HTMLCanvasElement} */
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Game state
const state = {
    money: 500,
    wave: 1,
    savedCivilians: 0,
    cityHealth: 100,
    startTime: Date.now(),
    gameTimer: 15, // 15 second head start
    units: [],
    zombies: [],
    civilians: [],
    projectiles: [],
    particles: [],
    lastTime: 0,
    mouseX: 0,
    mouseY: 0,
    screenShake: 0,
    placingUnit: null,
    gameOver: false,
};

// Config
const CONFIG = {
    WIDTH: 1000,
    HEIGHT: 600,
    ZOMBIE_SPAWN_CHANCE: 0.025,
    CIVILIAN_SPAWN_CHANCE: 0.01,
    START_MONEY: 500,
    CITY_HEALTH_MAX: 100,
    UNIT_COSTS: {
        soldier: 50,
        sniper: 150,
        tank: 600,
        turret: 300,
        medic: 100,
        barricade: 40,
        barbwire: 30,
        mine: 50,
        mg_nest: 400,
        mortar: 500,
        airstrike: 800,
        strafing_run: 400
    }
};

canvas.width = CONFIG.WIDTH;
canvas.height = CONFIG.HEIGHT;

// Entity Classes
class Entity {
    constructor(x, y, radius, color, speed) {
        this.x = x;
        this.y = y;
        this.radius = radius;
        this.color = color;
        this.speed = speed;
        this.health = 100;
        this.maxHealth = 100;
        this.toRemove = false;
    }

    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        
        // Draw Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.beginPath();
        ctx.ellipse(0, this.radius, this.radius * 0.8, this.radius * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
        ctx.fill();
        
        // Health bar
        if (this.health < this.maxHealth) {
            ctx.fillStyle = 'red';
            ctx.fillRect(-15, -this.radius - 10, 30, 4);
            ctx.fillStyle = 'green';
            ctx.fillRect(-15, -this.radius - 10, 30 * (this.health / this.maxHealth), 4);
        }
        ctx.restore();
    }
}

class Unit extends Entity {
    constructor(x, y, type) {
        let stats;
        switch(type) {
            case 'sniper': stats = { color: '#9b59b6', radius: 12, range: 450, fireRate: 0.4, damage: 60, health: 80 }; break;
            case 'tank': stats = { color: '#27ae60', radius: 25, range: 300, fireRate: 0.3, damage: 150, health: 500 }; break;
            case 'turret': stats = { color: '#7f8c8d', radius: 20, range: 250, fireRate: 3, damage: 10, health: 99999, ammo: 100 }; break;
            case 'medic': stats = { color: '#e74c3c', radius: 14, range: 150, fireRate: 1, damage: -10, health: 100 }; break;
            case 'barricade': stats = { color: '#a0522d', radius: 18, range: 0, fireRate: 0, damage: 0, health: 1000 }; break;
            case 'barbwire': stats = { color: '#708090', radius: 15, range: 20, fireRate: 0, damage: 2, health: 200 }; break;
            case 'mine': stats = { color: '#2f4f4f', radius: 8, range: 40, fireRate: 0, damage: 300, health: 1 }; break;
            case 'mg_nest': stats = { color: '#4b5320', radius: 22, range: 350, fireRate: 10, damage: 5, health: 400 }; break;
            case 'mortar': stats = { color: '#556b2f', radius: 20, range: 600, fireRate: 0.2, damage: 200, health: 250 }; break;
            default: stats = { color: '#3498db', radius: 16, range: 220, fireRate: 1.2, damage: 25, health: 120 };
        }
        
        super(x, y, stats.radius, stats.color, 0);
        this.type = type;
        this.range = stats.range;
        this.fireRate = stats.fireRate;
        this.damage = stats.damage;
        this.maxHealth = stats.health;
        this.health = stats.health;
        this.lastShot = 0;
        this.ammo = stats.ammo || Infinity;
        this.maxAmmo = stats.ammo || Infinity;
        this.reloading = false;
        this.reloadTime = 0;
    }

    update(dt, zombies, units) {
        if (this.reloading) {
            this.reloadTime -= dt;
            if (this.reloadTime <= 0) {
                this.reloading = false;
                this.ammo = this.maxAmmo;
            }
            return;
        }

        if (this.type === 'mine') {
            for (const z of zombies) {
                if (Math.hypot(this.x - z.x, this.y - z.y) < this.range) {
                    // Mine Insta-kill in area
                    state.projectiles.push(new Explosion(this.x, this.y, 100, 9999));
                    this.toRemove = true;
                    return;
                }
            }
            return;
        }

        if (this.type === 'barbwire') {
            for (const z of zombies) {
                if (Math.hypot(this.x - z.x, this.y - z.y) < this.radius + z.radius) {
                    z.speed *= 0.5; // Temporarily slow down handled in zombie update but applying damage here
                    z.health -= this.damage * dt;
                }
            }
            return;
        }

        this.lastShot += dt;
        if (this.lastShot >= 1 / this.fireRate) {
            if (this.type === 'medic') {
                // Heal closest damaged unit
                let closest = null;
                let minDist = this.range;
                for (const u of units) {
                    if (u === this || u.health >= u.maxHealth) continue;
                    const dist = Math.hypot(this.x - u.x, this.y - u.y);
                    if (dist < minDist) {
                        closest = u;
                        minDist = dist;
                    }
                }
                if (closest) {
                    closest.health = Math.min(closest.maxHealth, closest.health + 10);
                    this.lastShot = 0;
                }
            } else if (this.range > 0) {
                // Find closest zombie in range
                let closest = null;
                let distToClosest = this.range;
                for (const zombie of zombies) {
                    const dist = Math.hypot(this.x - zombie.x, this.y - zombie.y);
                    if (dist < distToClosest) {
                        closest = zombie;
                        distToClosest = dist;
                    }
                }
                if (closest) {
                    const pSize = this.type === 'tank' ? 8 : (this.type === 'mortar' ? 12 : 4);
                    state.projectiles.push(new Projectile(this.x, this.y, closest, this.damage, pSize, this.type === 'mortar'));
                    this.lastShot = 0;
                    
                    if (this.type === 'turret') {
                        this.ammo--;
                        if (this.ammo <= 0) {
                            this.reloading = true;
                            this.reloadTime = 10;
                        }
                    }
                }
            }
        }
    }

    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);

        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath();
        ctx.ellipse(0, 10, this.radius, this.radius/2, 0, 0, Math.PI*2);
        ctx.fill();

        // Reload Indicator
        if (this.reloading) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.font = 'bold 10px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('RELOADING', 0, -this.radius - 20);
            
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, -this.radius - 25, 8, -Math.PI/2, (Math.PI*2 * (this.reloadTime/10)) - Math.PI/2);
            ctx.stroke();
        }

        if (this.type === 'tank') {
            // High quality Tank
            ctx.fillStyle = '#1e8449';
            ctx.fillRect(-20, -15, 40, 30);
            ctx.fillStyle = '#111';
            ctx.fillRect(-22, -18, 44, 8);
            ctx.fillRect(-22, 10, 44, 8);
            ctx.fillStyle = '#2d5a27';
            ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1;
            ctx.strokeRect(-20, -15, 40, 30);
            ctx.fillStyle = '#1e8449';
            ctx.fillRect(5, -4, 25, 8);
        } else if (this.type === 'turret') {
            // High quality Turret
            ctx.fillStyle = '#333';
            ctx.fillRect(-15, -15, 30, 30);
            ctx.fillStyle = '#555';
            ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = '#222';
            ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI*2); ctx.fill();
            // Dual Barrels
            ctx.fillStyle = '#444';
            ctx.fillRect(10, -8, 20, 6);
            ctx.fillRect(10, 2, 20, 6);
        } else if (this.type === 'barricade') {
            ctx.fillStyle = '#5d4037';
            ctx.fillRect(-18, -12, 36, 24);
            ctx.strokeStyle = '#3e2723';
            ctx.lineWidth = 2;
            ctx.strokeRect(-18, -12, 36, 24);
            ctx.beginPath(); ctx.moveTo(-18,-12); ctx.lineTo(18,12); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(18,-12); ctx.lineTo(-18,12); ctx.stroke();
        } else if (this.type === 'barbwire') {
            ctx.strokeStyle = '#708090';
            ctx.lineWidth = 2;
            for(let i=0; i<3; i++) {
                ctx.beginPath(); ctx.arc(0, 0, 5 + i*5, 0, Math.PI*2); ctx.stroke();
            }
        } else if (this.type === 'mine') {
            ctx.fillStyle = '#2f4f4f';
            ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = 'red';
            ctx.beginPath(); ctx.arc(0, 0, 2, 0, Math.PI*2); ctx.fill();
        } else if (this.type === 'mg_nest') {
            ctx.fillStyle = '#4b5320';
            ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI*2); ctx.fill();
            ctx.strokeStyle = '#2d3410';
            ctx.lineWidth = 4;
            ctx.strokeRect(-15, -15, 30, 30);
            ctx.fillStyle = '#2d3410';
            ctx.fillRect(5, -4, 25, 8);
        } else if (this.type === 'mortar') {
            ctx.fillStyle = '#556b2f';
            ctx.fillRect(-15, -15, 30, 30);
            ctx.fillStyle = '#000';
            ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI*2); ctx.fill();
        } else {
            // Humonoid character
            ctx.fillStyle = this.color;
            // Body
            ctx.beginPath(); ctx.arc(0, 0, this.radius, 0, Math.PI * 2); ctx.fill();
            // Head
            ctx.fillStyle = '#ffdbac';
            ctx.beginPath(); ctx.arc(0, -this.radius/2, this.radius/2, 0, Math.PI * 2); ctx.fill();
            // Helmet/Hat
            ctx.fillStyle = this.color;
            ctx.beginPath(); ctx.arc(0, -this.radius/2 - 2, this.radius/1.5, Math.PI, 0); ctx.fill();
            // Weapon
            ctx.fillStyle = '#333';
            ctx.fillRect(5, -2, 15, 4);
        }

        if (this.health < this.maxHealth) {
            ctx.fillStyle = 'red';
            ctx.fillRect(-15, -this.radius - 15, 30, 4);
            ctx.fillStyle = 'green';
            ctx.fillRect(-15, -this.radius - 15, 30 * (this.health / this.maxHealth), 4);
        }
        ctx.restore();
    }
}

class Zombie extends Entity {
    constructor(x, y, level, type = 'regular') {
        let stats;
        switch(type) {
            case 'runner':
                stats = { radius: 14, color: '#4caf50', speed: 80 + level * 5, health: 40 + level * 10, damage: 10 + level, reward: 20 };
                break;
            case 'brute':
                stats = { radius: 22, color: '#1b5e20', speed: 20 + level * 2, health: 300 + level * 50, damage: 40 + level * 5, reward: 100 };
                break;
            default: // regular
                stats = { radius: 16, color: '#27ae60', speed: 35 + level * 4, health: 80 + level * 20, damage: 15 + level * 2, reward: 25 };
        }

        super(x, y, stats.radius, stats.color, stats.speed);
        this.type = type;
        this.damage = stats.damage;
        this.moneyReward = stats.reward + level * 5;
        this.maxHealth = stats.health;
        this.health = this.maxHealth;
        this.target = null;
    }

    update(dt, units, civilians) {
        // Find nearest target (unit or civilian)
        let nearestTarget = null;
        let minDist = Infinity;

        // Target units
        for (const u of units) {
            if (u.type === 'mine' || u.type === 'turret') continue; // Don't target mines or turrets
            const dist = Math.hypot(this.x - u.x, this.y - u.y);
            if (dist < minDist) {
                minDist = dist;
                nearestTarget = u;
            }
        }

        // Target civilians
        for (const c of civilians) {
            const dist = Math.hypot(this.x - c.x, this.y - c.y);
            if (dist < minDist) {
                minDist = dist;
                nearestTarget = c;
            }
        }

        if (nearestTarget) { // Zombies always chase someone if they exist
            // Chase target
            const dx = nearestTarget.x - this.x;
            const dy = nearestTarget.y - this.y;
            const dist = Math.hypot(dx, dy);
            
            if (dist > this.radius + nearestTarget.radius) {
                this.x += (dx / dist) * this.speed * dt;
                this.y += (dy / dist) * this.speed * dt;
            } else {
                // Attack
                nearestTarget.health -= this.damage * dt;
                if (nearestTarget.health <= 0) nearestTarget.toRemove = true;
                
                // If it's a civilian being attacked
                if (nearestTarget instanceof Civilian) {
                    nearestTarget.toRemove = true; 
                    state.screenShake = 5; // Cinematic shake when civilian dies
                }
            }
        } else {
            // Normal movement towards right if NO units/civilians left (unlikely but safe)
            this.x += this.speed * dt;
        }

        // Trap zombies at the right edge - they must break through defenses
        if (this.x > CONFIG.WIDTH - 50) {
            this.x = CONFIG.WIDTH - 50;
            // They attack the "city gate" (represented as health)
            state.cityHealth -= 2 * dt;
        }
    }

    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        
        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(0, 10, this.radius * 0.8, this.radius * 0.4, 0, 0, Math.PI*2); ctx.fill();

        // Body
        ctx.fillStyle = this.type === 'brute' ? '#0a2f0a' : (this.type === 'runner' ? '#66bb6a' : '#1b5e20');
        ctx.beginPath(); ctx.arc(0, 0, this.radius, 0, Math.PI * 2); ctx.fill();
        
        // Head
        ctx.fillStyle = this.type === 'brute' ? '#1b5e20' : '#4caf50';
        ctx.beginPath(); ctx.arc(0, -this.radius/2, this.radius/2, 0, Math.PI * 2); ctx.fill();
        
        // Glowing Eyes
        ctx.fillStyle = this.type === 'brute' ? '#ffeb3b' : 'red'; // Brutes have yellow eyes
        ctx.beginPath(); ctx.arc(-this.radius/4, -this.radius/2, this.type === 'brute' ? 3 : 2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(this.radius/4, -this.radius/2, this.type === 'brute' ? 3 : 2, 0, Math.PI * 2); ctx.fill();

        // Arms (Runners have more aggressive poses)
        ctx.strokeStyle = this.type === 'brute' ? '#0a2f0a' : '#1b5e20';
        ctx.lineWidth = this.type === 'brute' ? 6 : 4;
        const armAngle = this.type === 'runner' ? -0.8 : -0.2;
        ctx.beginPath(); ctx.moveTo(this.radius, 0); ctx.lineTo(this.radius + (this.type === 'brute' ? 15 : 10), armAngle * 10); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-this.radius, 0); ctx.lineTo(-this.radius - (this.type === 'brute' ? 15 : 10), armAngle * 10); ctx.stroke();

        // Extra "Brute" features
        if (this.type === 'brute') {
            ctx.fillStyle = 'rgba(0,0,0,0.2)';
            ctx.fillRect(-this.radius/2, -this.radius, this.radius, 5); // Scars/Armor
        }

        // Health bar
        if (this.health < this.maxHealth) {
            ctx.fillStyle = 'red';
            ctx.fillRect(-15, -this.radius - 15, 30, 4);
            ctx.fillStyle = 'green';
            ctx.fillRect(-15, -this.radius - 15, 30 * (this.health / this.maxHealth), 4);
        }
        ctx.restore();
    }
}

class Civilian extends Entity {
    constructor(x, y) {
        // Force civilians to road height (middle 400px of 600px height)
        const roadY = Math.max(120, Math.min(480, y));
        super(x, roadY, 12, '#f1c40f', 65);
    }

    update(dt, zombies) {
        this.x += this.speed * dt;
        
        // Flee from zombies but stay on road
        for (const z of zombies) {
            const dist = Math.hypot(this.x - z.x, this.y - z.y);
            if (dist < 100) {
                const dy = this.y - z.y;
                // Move vertically but stay between road boundaries (100-500)
                const moveY = (dy > 0 ? 1 : -1) * this.speed * 0.5 * dt;
                if (this.y + moveY > 120 && this.y + moveY < 480) {
                    this.y += moveY;
                }
            }
        }

        if (this.x > CONFIG.WIDTH) {
            state.savedCivilians++;
            state.money += 40;
            this.toRemove = true;
        }
    }

    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        
        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(0, 8, 10, 5, 0, 0, Math.PI*2); ctx.fill();

        // Body
        ctx.fillStyle = '#f1c40f'; // Shirt
        ctx.beginPath(); ctx.arc(0, 0, this.radius, 0, Math.PI * 2); ctx.fill();
        
        // Head
        ctx.fillStyle = '#ffdbac';
        ctx.beginPath(); ctx.arc(0, -this.radius/2, this.radius/2, 0, Math.PI * 2); ctx.fill();
        
        // Hair
        ctx.fillStyle = '#4e342e';
        ctx.beginPath(); ctx.arc(0, -this.radius/2 - 2, this.radius/2, Math.PI, 0); ctx.fill();

        ctx.restore();
    }
}

class Projectile {
    constructor(x, y, target, damage, radius = 4, isMortar = false) {
        this.x = x;
        this.y = y;
        this.startX = x;
        this.startY = y;
        this.target = target;
        this.targetX = target.x;
        this.targetY = target.y;
        this.damage = damage;
        this.radius = radius;
        this.isMortar = isMortar;
        this.speed = isMortar ? 200 : 500;
        this.toRemove = false;
        this.progress = 0;
        this.totalDist = Math.hypot(this.targetX - this.x, this.targetY - this.y);
    }

    update(dt) {
        if (this.isMortar) {
            this.progress += (this.speed * dt) / this.totalDist;
            if (this.progress >= 1) {
                // Explosion
                state.projectiles.push(new Explosion(this.targetX, this.targetY, 80, this.damage));
                this.toRemove = true;
                return;
            }
            this.x = this.startX + (this.targetX - this.startX) * this.progress;
            this.y = this.startY + (this.targetY - this.startY) * this.progress;
            // Arc height
            const height = Math.sin(this.progress * Math.PI) * 100;
            this.drawY = this.y - height;
        } else {
            if (this.target.toRemove) {
                this.toRemove = true;
                return;
            }
            const dx = this.target.x - this.x;
            const dy = this.target.y - this.y;
            const dist = Math.hypot(dx, dy);

            if (dist < this.radius + this.target.radius) {
                this.target.health -= this.damage;
                if (this.target.health <= 0) {
                    this.target.toRemove = true;
                    state.money += this.target.moneyReward;
                }
                this.toRemove = true;
                return;
            }

            this.x += (dx / dist) * this.speed * dt;
            this.y += (dy / dist) * this.speed * dt;
            this.drawY = this.y;
        }
    }

    draw() {
        ctx.save();
        ctx.fillStyle = this.isMortar ? '#333' : '#f1c40f';
        ctx.beginPath();
        ctx.arc(this.x, this.drawY, this.radius, 0, Math.PI * 2);
        ctx.fill();
        if (!this.isMortar) {
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#f1c40f';
            ctx.fill();
        }
        ctx.restore();
    }
}

class Explosion {
    constructor(x, y, radius, damage) {
        this.x = x;
        this.y = y;
        this.radius = radius;
        this.damage = damage;
        this.life = 0.5;
        this.maxLife = 0.5;
        this.toRemove = false;
        this.hasDamaged = false;
        state.screenShake = 10; // Boom!
    }

    update(dt) {
        this.life -= dt;
        if (this.life <= 0) this.toRemove = true;

        if (!this.hasDamaged) {
            state.zombies.forEach(z => {
                const dist = Math.hypot(this.x - z.x, this.y - z.y);
                if (dist < this.radius) {
                    z.health -= this.damage;
                    if (z.health <= 0) {
                        z.toRemove = true;
                        state.money += z.moneyReward;
                    }
                }
            });
            // Spawn particles
            for(let i=0; i<15; i++) {
                state.particles.push(new Particle(this.x, this.y, '#ff4500'));
            }
            this.hasDamaged = true;
        }
    }

    draw() {
        ctx.save();
        const alpha = this.life / this.maxLife;
        const grad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.radius);
        grad.addColorStop(0, `rgba(255, 200, 50, ${alpha})`);
        grad.addColorStop(0.5, `rgba(255, 100, 0, ${alpha * 0.8})`);
        grad.addColorStop(1, `rgba(255, 0, 0, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius * (1.2 - alpha), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

class Particle {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.vx = (Math.random() - 0.5) * 200;
        this.vy = (Math.random() - 0.5) * 200;
        this.life = 1.0;
        this.toRemove = false;
    }

    update(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.life -= dt * 2;
        if (this.life <= 0) this.toRemove = true;
    }

    draw() {
        ctx.globalAlpha = this.life;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
    }
}

class SupportCall {
    constructor(x, y, type) {
        this.x = x;
        this.y = y;
        this.type = type;
        this.timer = type === 'airstrike' ? 1.5 : 0.5;
        this.toRemove = false;
        this.executed = false;
        state.screenShake = 5;
    }

    update(dt) {
        this.timer -= dt;
        if (this.timer <= 0 && !this.executed) {
            if (this.type === 'airstrike') {
                // Massive spread of explosions
                for(let i=0; i<5; i++) {
                    const ox = (Math.random() - 0.5) * 150;
                    const oy = (Math.random() - 0.5) * 150;
                    state.projectiles.push(new Explosion(this.x + ox, this.y + oy, 120, 500));
                }
            } else if (this.type === 'strafing_run') {
                // Line of bullets/mini-explosions
                for(let i=0; i<10; i++) {
                    setTimeout(() => {
                        state.projectiles.push(new Explosion(this.x - 200 + (i * 40), this.y, 40, 100));
                    }, i * 50);
                }
            }
            this.executed = true;
            this.toRemove = true;
        }
    }

    draw() {
        if (!this.executed) {
            ctx.save();
            ctx.strokeStyle = this.type === 'airstrike' ? 'red' : 'orange';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.type === 'airstrike' ? 100 : 40, 0, Math.PI * 2);
            ctx.stroke();
            // Flare effect
            ctx.fillStyle = this.type === 'airstrike' ? 'rgba(255,0,0,0.3)' : 'rgba(255,165,0,0.3)';
            ctx.beginPath();
            ctx.arc(this.x, this.y, 5 * (1 + Math.sin(Date.now()/100)), 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }
}

// UI Elements
const ui = {
    money: document.getElementById('money'),
    wave: document.getElementById('wave'),
    saved: document.getElementById('saved'),
    health: document.getElementById('health'),
    gameOver: document.getElementById('game-over'),
    finalWaves: document.getElementById('final-waves')
};

function updateUI() {
    ui.money.innerText = Math.floor(state.money);
    ui.wave.innerText = state.wave;
    ui.saved.innerText = state.savedCivilians;
    ui.health.innerText = Math.max(0, Math.floor(state.cityHealth));
}

// Input Handlers
document.querySelectorAll('.unit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const type = e.target.getAttribute('data-unit');
        const cost = CONFIG.UNIT_COSTS[type];
        if (state.money >= cost) {
            state.placingUnit = type;
            canvas.style.cursor = 'copy';
        }
    });
});

canvas.addEventListener('click', (e) => {
    if (state.placingUnit) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        
        const cost = CONFIG.UNIT_COSTS[state.placingUnit];
        if (state.money >= cost) {
            if (state.placingUnit === 'airstrike') {
                state.projectiles.push(new SupportCall(x, y, 'airstrike'));
                state.money -= cost;
                state.placingUnit = null;
                canvas.style.cursor = 'crosshair';
            } else if (state.placingUnit === 'strafing_run') {
                state.projectiles.push(new SupportCall(x, y, 'strafing_run'));
                state.money -= cost;
                state.placingUnit = null;
                canvas.style.cursor = 'crosshair';
            } else {
                state.units.push(new Unit(x, y, state.placingUnit));
                state.money -= cost;
            }
        } else {
            state.placingUnit = null;
            canvas.style.cursor = 'crosshair';
        }
    }
});

// Right click to cancel placement
canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    state.placingUnit = null;
    canvas.style.cursor = 'crosshair';
});

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    state.mouseX = (e.clientX - rect.left) * scaleX;
    state.mouseY = (e.clientY - rect.top) * scaleY;
});

// Game Loop
function loop(timestamp) {
    if (state.gameOver) return;
    if (!state.lastTime) state.lastTime = timestamp;

    const dt = (timestamp - state.lastTime) / 1000;
    state.lastTime = timestamp;

    update(dt);
    
    ctx.save();
    if (state.screenShake > 0) {
        const sx = (Math.random() - 0.5) * state.screenShake;
        const sy = (Math.random() - 0.5) * state.screenShake;
        ctx.translate(sx, sy);
        state.screenShake *= 0.9; // Decay
        if (state.screenShake < 0.1) state.screenShake = 0;
    }
    draw();
    ctx.restore();
    
    updateUI();

    requestAnimationFrame(loop);
}

function update(dt) {
    if (state.gameOver) return;

    if (state.gameTimer > 0) {
        state.gameTimer -= dt;
        return;
    }

    if (state.cityHealth <= 0) {
        state.gameOver = true;
        ui.gameOver.classList.remove('hidden');
        ui.finalWaves.innerText = state.wave;
        return;
    }

    // Spawn logic
    if (Math.random() < CONFIG.ZOMBIE_SPAWN_CHANCE + (state.wave * 0.002)) {
        const rand = Math.random();
        let type = 'regular';
        if (rand < 0.1) type = 'brute';
        else if (rand < 0.3) type = 'runner';
        
        state.zombies.push(new Zombie(-30, Math.random() * (canvas.height - 180) + 120, state.wave, type));
    }
    if (Math.random() < CONFIG.CIVILIAN_SPAWN_CHANCE) {
        state.civilians.push(new Civilian(-30, Math.random() * (canvas.height - 180) + 120));
    }

    // Update wave
    const targetWave = Math.floor(state.savedCivilians / 5) + 1;
    if (targetWave > state.wave) {
        state.wave = targetWave;
        state.money += 250; // Increased bonus
        state.screenShake = 15; // Visual feedback for new wave
    }

    // Passive Income
    state.money += dt * (state.wave * 2.5); // Increased passive income

    // Update entities
    state.units.forEach(u => u.update(dt, state.zombies, state.units));
    state.zombies.forEach(z => z.update(dt, state.units, state.civilians));
    state.civilians.forEach(c => c.update(dt, state.zombies));
    state.particles.forEach(p => p.update(dt));

    // Update projectiles and explosions
    state.projectiles.forEach(p => p.update(dt));

    // Collision: Zombies vs Civilians (Extra check but handled in Zombie update)
    state.civilians.forEach(c => {
        state.zombies.forEach(z => {
            if (Math.hypot(c.x - z.x, c.y - z.y) < c.radius + z.radius) {
                c.toRemove = true;
                state.particles.push(new Particle(c.x, c.y, 'red'));
            }
        });
    });

    // Cleanup
    state.units = state.units.filter(u => !u.toRemove);
    state.zombies = state.zombies.filter(z => !z.toRemove);
    state.civilians = state.civilians.filter(c => !c.toRemove);
    state.projectiles = state.projectiles.filter(p => !p.toRemove);
    state.particles = state.particles.filter(p => !p.toRemove);
}

function draw() {
    // Clear
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Initial Timer UI
    if (state.gameTimer > 0) {
        ctx.save();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.font = 'bold 40px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`PREPARING DEFENSES: ${Math.ceil(state.gameTimer)}s`, canvas.width/2, canvas.height/2);
        ctx.restore();
    }

    // Draw Map: Urban Combat Zone Cinematic
    // Fog/Vignette background
    const bgGrad = ctx.createRadialGradient(canvas.width/2, canvas.height/2, 100, canvas.width/2, canvas.height/2, 800);
    bgGrad.addColorStop(0, '#1a1a2e'); // Deep blueish tint
    bgGrad.addColorStop(1, '#050505');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Road Texture with Sidewalks
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 100, canvas.width, 400);
    ctx.fillStyle = '#333';
    ctx.fillRect(0, 100, canvas.width, 15);
    ctx.fillRect(0, 485, canvas.width, 15);
    
    // Distress markings and cracks
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for(let i=0; i<canvas.width; i+=40) {
        ctx.beginPath();
        ctx.moveTo(i, 115);
        ctx.lineTo(i + (Math.random()-0.5)*30, 485);
        ctx.stroke();
    }

    // Road lines (ruined and bloodied)
    ctx.strokeStyle = '#3e1a1a'; // Bloody center lines
    ctx.setLineDash([30, 60]);
    ctx.beginPath();
    ctx.moveTo(0, 300);
    ctx.lineTo(canvas.width, 300);
    ctx.stroke();
    ctx.setLineDash([]);

    // Blood splatter textures and craters
    for (let i = 0; i < 40; i++) {
        const rx = (i * 37) % canvas.width;
        const ry = 115 + (i * 19) % 370;
        
        // Craters
        if (i % 5 === 0) {
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.beginPath(); ctx.ellipse(rx, ry, 15, 8, Math.random(), 0, Math.PI*2); ctx.fill();
        }
        
        ctx.fillStyle = i % 2 === 0 ? '#400' : '#222';
        ctx.beginPath();
        ctx.arc(rx, ry, Math.random()*3 + 1, 0, Math.PI*2);
        ctx.fill();
    }

    // Buildings with Glow
    for (let i = 0; i < 12; i++) {
        const bx = i * 100;
        const bHeightTop = 70 + (i % 3) * 20;
        const bHeightBot = 70 + (i % 2) * 30;

        ctx.fillStyle = '#050507';
        ctx.fillRect(bx, 100 - bHeightTop, 80, bHeightTop);
        ctx.fillRect(bx + 10, 500, 70, bHeightBot);
        
        // Windows with dynamic light
        if ((i + Math.floor(state.lastTime/500)) % 4 === 0) {
            ctx.shadowBlur = 10;
            ctx.shadowColor = 'orange';
            ctx.fillStyle = 'rgba(255, 180, 50, 0.1)';
            ctx.fillRect(bx + 20, 100 - bHeightTop + 20, 10, 15);
            ctx.shadowBlur = 0;
        }
    }

    // City Gate / Right Wall (The defense point)
    ctx.fillStyle = '#2c3e50';
    ctx.fillRect(canvas.width - 25, 0, 25, canvas.height);
    // Metal texture stripes
    ctx.fillStyle = '#1a252f';
    for(let j=0; j<canvas.height; j+=20) {
        ctx.fillRect(canvas.width - 25, j, 25, 2);
    }
    ctx.strokeStyle = '#34495e';
    ctx.lineWidth = 3;
    ctx.strokeRect(canvas.width - 25, 0, 25, canvas.height);

    // Draw entities
    state.units.forEach(u => u.draw());
    state.zombies.forEach(z => z.draw());
    state.civilians.forEach(c => c.draw());
    state.projectiles.forEach(p => p.draw());
    state.particles.forEach(p => p.draw());

    // Filter overlay for cinematic look (Gritty blue/grey)
    const overlay = ctx.createLinearGradient(0, 0, 0, canvas.height);
    overlay.addColorStop(0, 'rgba(0, 10, 20, 0.4)');
    overlay.addColorStop(0.5, 'rgba(10, 0, 0, 0.1)');
    overlay.addColorStop(1, 'rgba(0, 10, 20, 0.4)');
    ctx.fillStyle = overlay;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw placement preview
    if (state.placingUnit) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        let radius = 16;
        let color = '#3498db';
        let range = 220;

        switch(state.placingUnit) {
            case 'tank': radius = 25; color = '#27ae60'; range = 300; break;
            case 'turret': radius = 20; color = '#7f8c8d'; range = 250; break;
            case 'sniper': radius = 12; color = '#9b59b6'; range = 450; break;
            case 'barricade': radius = 18; color = '#a0522d'; range = 0; break;
            case 'barbwire': radius = 15; color = '#708090'; range = 0; break;
            case 'mine': radius = 8; color = '#2f4f4f'; range = 40; break;
            case 'mg_nest': radius = 22; color = '#4b5320'; range = 350; break;
            case 'mortar': radius = 20; color = '#556b2f'; range = 600; break;
        }
        
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(state.mouseX, state.mouseY, radius, 0, Math.PI * 2);
        ctx.fill();
        
        // Range indicator
        if (range > 0) {
            ctx.strokeStyle = color;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.arc(state.mouseX, state.mouseY, range, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();
    }
}

requestAnimationFrame(loop);
