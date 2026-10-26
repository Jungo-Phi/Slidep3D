import { mount } from 'svelte'
import { Object3D } from 'three'
import App from './App.svelte'

// Z vers le haut dans toute l'application.
Object3D.DEFAULT_UP.set(0, 0, 1)

mount(App, { target: document.getElementById('app')! })
